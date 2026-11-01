const IMG = "https://image.tmdb.org/t/p/";
const LANG = "es-MX";
const REGION = "MX";
const TTL_MS = 10 * 60 * 1000;
const PROV = {
  netflix: "8",
  prime: "119|9",
  todas: "8|1899|384|119|9|337",
};

const memo = new Map();

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
  const data = await kino.tmdb(path, p);
  memo.set(key, { at: Date.now(), data });
  return data;
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

function rowDefs() {
  const platform = (key, name) => [
    {
      id: key + "-pelis",
      title: t("Películas de estreno en " + name, "New movies on " + name),
      genre: "peliculas",
      load: async () => items(await premieres("movie", PROV[key]), 20),
    },
    {
      id: key + "-series",
      title: t("Series de estreno en " + name, "New series on " + name),
      genre: "series",
      load: async () => items(await premieres("series", PROV[key]), 20),
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

function norm(s) {
  let x = String(s || "").toLowerCase();
  if (typeof x.normalize === "function") x = x.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return x.replace(/[^a-z0-9]+/g, " ").trim();
}

async function loadWatched() {
  await null;
  const out = { map: null, err: "", n: 0 };
  if (typeof kino.library !== "object") {
    out.err = "sin_library";
    return out;
  }
  const map = new Map();
  try {
    for (const k of ["movie", "series"]) {
      const list = await kino.library.watched({ limit: 100, kind: k });
      for (const e of list || []) {
        if (!e) continue;
        out.n++;
        if (e.ids && e.ids.tmdb) map.set(e.kind + ":" + e.ids.tmdb, e);
        if (e.title) map.set(e.kind + ":t:" + norm(e.title), e);
      }
    }
  } catch (e) {
    out.err = (e && e.code) || "error";
    return out;
  }
  out.map = map;
  return out;
}

function hint(w) {
  if (w.err === "permission_denied") return " ⚠ permiso de biblioteca apagado";
  if (w.err) return " ⚠ biblioteca: " + w.err;
  if (w.n === 0) return " ⚠ biblioteca vacía";
  return "";
}

async function statusOf(it, e) {
  const p = Number(e.progress) || 0;
  if (it.kind === "movie") {
    if (p >= 0.95) return { done: true };
    if (p > 0) return { text: t("Seguir viendo", "Keep watching") };
    return null;
  }
  const s = e.season;
  const n = e.episode;
  if (!s || !n) return p >= 0.95 ? null : { text: t("Seguir viendo", "Keep watching") };
  let last = null;
  try {
    const d = await tmdb("/tv/" + it.ids.tmdb, {});
    last = d && d.last_episode_to_air;
  } catch (err) {
    last = null;
  }
  if (last && last.season_number === s && n >= last.episode_number && p >= 0.95) {
    return { done: true };
  }
  const where = "T" + s + " · Cap. " + n;
  if (p >= 0.95) {
    return { text: t("Seguir viendo · terminaste " + where, "Keep watching · finished S" + s + " · Ep. " + n) };
  }
  return { text: t("Seguir viendo · " + where, "Keep watching · S" + s + " · Ep. " + n) };
}

async function mark(list, watched) {
  if (!watched) return list;
  return Promise.all(
    list.map(async (it) => {
      const e =
        watched.get(it.kind + ":" + it.ids.tmdb) ||
        watched.get(it.kind + ":t:" + norm(it.title));
      if (!e) return it;
      const st = await statusOf(it, e);
      if (!st) return it;
      const label = st.done ? t("Visto", "Watched") : st.text;
      it.title = (st.done ? "✅ " : "▶ ") + it.title;
      it.overview = (label + (it.overview ? "\n\n" + it.overview : "")).slice(0, 2000);
      return it;
    })
  );
}

async function buildRows(defs) {
  const errs = [];
  const w = await loadWatched();
  const rows = await Promise.all(
    defs.map(async (d) => {
      try {
        let list = await d.load();
        list = await mark(list, w.map);
        if (!list.length) {
          errs.push(d.id + ": vacia");
          return null;
        }
        const row = { id: d.id, title: d.title, items: list };
        if (d.genre) row.genre = d.genre;
        return row;
      } catch (e) {
        errs.push(d.id + ": " + errText(e));
        return null;
      }
    })
  );
  const ok = rows.filter(Boolean);
  if (ok.length) {
    const note = hint(w);
    if (note) ok[0].title = (ok[0].title + note).slice(0, 190);
    return ok;
  }
  return [
    {
      id: "diagnostico",
      title: ("Sin datos. " + (errs[0] || "")).slice(0, 190),
      items: [{ id: "d1", ref: "movie:0", title: "Reintenta en unos minutos", kind: "movie" }],
    },
  ];
}

export async function home() {
  const all = rowDefs();
  const order = ["vistas", "estrenos", "netflix", "prime", "kdramas", "turcas"];
  const defs = [];
  for (const k of order) defs.push(...all[k]);
  return buildRows(defs);
}

export async function section({ tab }) {
  const all = rowDefs();
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