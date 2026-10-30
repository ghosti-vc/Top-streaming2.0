const IMG = "https://image.tmdb.org/t/p/";
const LANG = "es-MX";
const REGION = "MX";
const TTL_MS = 10 * 60 * 1000;
const WINDOW = 45; // dias para considerar un titulo "de estreno"
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
  params[f + ".gte"] = day(-WINDOW);
  params[f + ".lte"] = day(0);
  return raw(kind, "/discover/" + (isMovie ? "movie" : "tv"), params);
}

async function safe(promise) {
  try {
    return await promise;
  } catch (e) {
    return [];
  }
}

function discoverMovies(providers, extra) {
  const params = Object.assign(
    {
      watch_region: REGION,
      with_watch_providers: providers,
      with_watch_monetization_types: "flatrate",
      sort_by: "popularity.desc",
      "primary_release_date.gte": day(-WINDOW),
      "primary_release_date.lte": day(0),
    },
    extra || {}
  );
  for (const k of Object.keys(params)) {
    if (params[k] === undefined || params[k] === null) delete params[k];
  }
  return raw("movie", "/discover/movie", params);
}

// Deja solo titulos lanzados dentro de la ventana de estrenos.
function recentOnly(list) {
  const from = day(-WINDOW);
  const to = day(0);
  return list.filter(({ r }) => {
    const d = String((r && (r.release_date || r.first_air_date)) || "");
    return d >= from && d <= to;
  });
}

// Peliculas por plataforma, siempre dentro de los ultimos WINDOW dias.
// Varias consultas distintas se combinan y se quitan los repetidos.
async function moviesPlatform(providers) {
  const lists = await Promise.all([
    safe(discoverMovies(providers, {})),
    safe(discoverMovies(providers, { sort_by: "primary_release_date.desc" })),
    safe(discoverMovies(providers, { with_watch_monetization_types: undefined })),
  ]);
  return [].concat(...lists);
}

// Peliculas de estreno en general: plataformas + cartelera de Mexico + tendencias.
async function moviesGeneral() {
  const lists = await Promise.all([
    safe(discoverMovies(PROV.todas, {})),
    safe(discoverMovies(PROV.todas, { sort_by: "primary_release_date.desc" })),
    safe(raw("movie", "/movie/now_playing", { region: REGION }).then(recentOnly)),
    safe(raw("movie", "/trending/movie/week", {}).then(recentOnly)),
  ]);
  return [].concat(...lists);
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
      load: async () => items(await moviesPlatform(PROV[key]), 20),
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
        load: async () => items(await moviesGeneral(), 20),
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

async function buildRows(defs) {
  const errs = [];
  const rows = await Promise.all(
    defs.map(async (d) => {
      try {
        const list = await d.load();
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
  if (ok.length) return ok;
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
