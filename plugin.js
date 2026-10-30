const IMG = "https://image.tmdb.org/t/p/";
const LANG = "es-MX";
const REGION = "MX";
const TTL_MS = 10 * 60 * 1000;
const FRESH_MS = 15 * 60 * 1000;
const MAX_AT_ONCE = 4;
const PROV = {
  netflix: "8",
  prime: "119|9",
  todas: "8|119|9",
};

const memo = new Map();

// Cola: como máximo MAX_AT_ONCE consultas a TMDB al mismo tiempo.
let active = 0;
const waiters = [];
async function takeSlot() {
  if (active < MAX_AT_ONCE) {
    active++;
    return;
  }
  await new Promise((resolve) => waiters.push(resolve));
}
function freeSlot() {
  const next = waiters.shift();
  if (next) next();
  else active--;
}

function en() {
  return kino.lang === "en-US";
}
function t(es, enText) {
  return en() ? enText : es;
}
function errText(e) {
  return e && (e.code || e.message) ? (e.code || "") + " " + (e.message || "") : String(e);
}

async function tmdb(path, params) {
  await null;
  if (typeof kino.tmdb !== "function") {
    throw kino.error("unavailable", "kino.tmdb no existe", {
      userMessage: "Actualiza la app para ver este contenido.",
    });
  }
  const p = Object.assign({ language: LANG }, params || {});
  const key = path + "?" + JSON.stringify(p);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  await takeSlot();
  try {
    const data = await kino.tmdb(path, p);
    memo.set(key, { at: Date.now(), data });
    return data;
  } finally {
    freeSlot();
  }
}

function day(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function toItem(r, kind) {
  const title = r && (r.title || r.name);
  if (!title || !r.id) return null;
  const date = String(r.release_date || r.first_air_date || "");
  const item = {
    id: (kind === "movie" ? "m" : "s") + r.id,
    ref: (kind === "movie" ? "movie:" : "tv:") + r.id,
    title: String(title).slice(0, 200),
    kind,
    ids: { tmdb: r.id },
  };
  if (/^\d{4}/.test(date)) item.year = date.slice(0, 4);
  if (r.poster_path) item.poster = IMG + "w500" + r.poster_path;
  if (r.backdrop_path) item.backdrop = IMG + "w780" + r.backdrop_path;
  if (r.overview) item.overview = String(r.overview).slice(0, 2000);
  if (r.vote_average > 0) item.rating = Math.round(r.vote_average * 10) / 10;
  return item;
}

async function raw(kind, path, params) {
  const d = await tmdb(path, params);
  const results = Array.isArray(d) ? d : d && Array.isArray(d.results) ? d.results : [];
  return results.map((r) => ({ r, kind }));
}

function items(list, limit) {
  const out = [];
  const seen = new Set();
  for (const { r, kind } of list) {
    const it = toItem(r, kind);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

function trending(kind) {
  return raw(kind, "/trending/" + (kind === "movie" ? "movie" : "tv") + "/day", {});
}

function premieres(kind, providers) {
  const isMovie = kind === "movie";
  const f = isMovie ? "primary_release_date" : "first_air_date";
  const params = {
    watch_region: REGION,
    with_watch_providers: providers,
    with_watch_monetization_types: "flatrate",
    sort_by: "popularity.desc",
  };
  params[f + ".gte"] = day(-45);
  params[f + ".lte"] = day(0);
  return raw(kind, "/discover/" + (isMovie ? "movie" : "tv"), params);
}

// Consulta más ligera (sin fechas): lo más popular de la plataforma.
function topOf(kind, providers) {
  return raw(kind, "/discover/" + (kind === "movie" ? "movie" : "tv"), {
    watch_region: REGION,
    with_watch_providers: providers,
    with_watch_monetization_types: "flatrate",
    sort_by: "popularity.desc",
  });
}

// En las pestañas: estrenos y "lo más popular" salen a la vez; gana la primera que traiga títulos.
async function platformList(kind, providers) {
  let err = null;
  const fail = (e) => {
    if (!err) err = e;
    return [];
  };
  const [a, b] = await Promise.all([
    premieres(kind, providers).then((r) => items(r, 20)).catch(fail),
    topOf(kind, providers).then((r) => items(r, 20)).catch(fail),
  ]);
  if (a.length) return a;
  if (b.length) return b;
  throw err || kino.error("unavailable", "vacia");
}

function kdramas() {
  return raw("series", "/discover/tv", {
    with_origin_country: "KR",
    with_original_language: "ko",
    sort_by: "popularity.desc",
  });
}

function turcas() {
  return raw("series", "/discover/tv", {
    with_origin_country: "TR",
    with_original_language: "tr",
    sort_by: "popularity.desc",
  });
}

// full = true solo en las pestañas (con respaldo); en el Inicio, una sola consulta por fila.
function rowDefs(full) {
  const platform = (key, name) => [
    {
      id: key + "-pelis",
      title: t("Películas de estreno en " + name, "New movies on " + name),
      genre: "peliculas",
      load: async () =>
        full ? platformList("movie", PROV[key]) : items(await premieres("movie", PROV[key]), 20),
    },
    {
      id: key + "-series",
      title: t("Series de estreno en " + name, "New series on " + name),
      genre: "series",
      load: async () =>
        full ? platformList("series", PROV[key]) : items(await premieres("series", PROV[key]), 20),
    },
  ];
  return {
    estrenos: [
      {
        id: "estrenos-pelis",
        title: t("Películas de estreno", "New movies"),
        genre: "peliculas",
        load: async () => items(await premieres("movie", PROV.todas), 20),
      },
      {
        id: "estrenos-series",
        title: t("Series de estreno", "New series"),
        genre: "series",
        load: async () => items(await premieres("series", PROV.todas), 20),
      },
    ],
    vistas: [
      {
        id: "top-peliculas",
        title: t("Top 20 películas más vistas", "Top 20 most watched movies"),
        genre: "peliculas",
        load: async () => items(await trending("movie"), 20),
      },
      {
        id: "top-series",
        title: t("Top 20 series más vistas", "Top 20 most watched series"),
        genre: "series",
        load: async () => items(await trending("series"), 20),
      },
    ],
    netflix: platform("netflix", "Netflix"),
    prime: platform("prime", "Prime Video"),
    kdramas: [
      {
        id: "top-kdramas",
        title: t("Top 20 K-dramas más vistos", "Top 20 most watched K-dramas"),
        genre: "doramas",
        load: async () => items(await kdramas(), 20),
      },
    ],
    turcas: [
      {
        id: "top-turcas",
        title: t("Top 20 series turcas", "Top 20 Turkish series"),
        genre: "series",
        load: async () => items(await turcas(), 20),
      },
    ],
  };
}

async function cacheGet(id) {
  try {
    const v = await kino.storage.get("row:" + id);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}

async function cachePut(id, list) {
  try {
    const slim = list.slice(0, 15).map((it) => {
      const c = Object.assign({}, it);
      delete c.backdrop;
      if (c.overview) c.overview = c.overview.slice(0, 200);
      return c;
    });
    await kino.storage.set("row:" + id, JSON.stringify({ at: Date.now(), list: slim }));
  } catch (e) {}
}

async function buildRows(defs) {
  const errs = [];
  const rows = await Promise.all(
    defs.map(async (d) => {
      const saved = await cacheGet(d.id);
      if (saved && saved.list && saved.list.length && Date.now() - saved.at < FRESH_MS) {
        return { id: d.id, title: d.title, genre: d.genre, items: saved.list };
      }
      let list = null;
      try {
        list = await d.load();
        if (!list.length) {
          errs.push(d.id + ": vacia");
          list = null;
        } else {
          await cachePut(d.id, list);
        }
      } catch (e) {
        errs.push(d.id + ": " + errText(e));
        list = saved && saved.list ? saved.list : null;
      }
      if (!list || !list.length) return null;
      return { id: d.id, title: d.title, genre: d.genre, items: list };
    })
  );
  const ok = rows.filter(Boolean);
  if (errs.length) {
    ok.push({
      id: "aviso",
      title: ("Faltan filas: " + errs.slice(0, 3).join(" | ")).slice(0, 190),
      items: [{ id: "a1", ref: "movie:0", title: "Reintenta en unos minutos", kind: "movie" }],
    });
  }
  return ok;
}

export async function home() {
  const all = rowDefs(false);
  const order = ["vistas", "estrenos", "netflix", "prime", "kdramas", "turcas"];
  const defs = [];
  for (const k of order) defs.push(...all[k]);
  return buildRows(defs);
}

export async function section({ tab }) {
  const all = rowDefs(true);
  const tabs = [
    { id: "vistas", label: t("Más vistas", "Most watched") },
    { id: "estrenos", label: t("Estrenos", "New") },
    { id: "netflix", label: "Netflix" },
    { id: "prime", label: "Prime Video" },
    { id: "kdramas", label: "K-dramas" },
    { id: "turcas", label: t("Series turcas", "Turkish series") },
  ];
  const chosen = tabs.some((x) => x.id === tab) ? tab : "vistas";
  return { tabs, tab: chosen, rows: await buildRows(all[chosen]) };
}

export async function episodes(ref) {
  await null;
  return { episodes: [] };
}

export async function resolve(ref) {
  await null;
  throw kino.error("not_found", "solo catalogo", {
    userMessage: "Este catálogo no reproduce: busca el título en tus otras fuentes.",
  });
}