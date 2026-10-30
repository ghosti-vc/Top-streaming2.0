const IMG = "https://image.tmdb.org/t/p/";
const LANG = "es-MX";
const REGION = "MX";
const TTL_MS = 10 * 60 * 1000;
const CONCURRENCY = 3;
const PACE_MS = 250;
const PROV = {
  todas: "8|1899|384|119|9|337",
};

const memo = new Map();
let nextAt = 0;

// Una consulta cada 250 ms y como mucho 3 a la vez: en un TV lento, 10 a la vez
// hacen que TMDB corte algunas por tiempo o por límite, y esas filas desaparecían.
async function pace() {
  const now = Date.now();
  const at = now > nextAt ? now : nextAt;
  nextAt = at + PACE_MS;
  if (at > now) await kino.sleep(at - now);
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
  await pace();
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

// ---------- Cinemeta (el catálogo de Stremio, hecho con datos de IMDb) ----------
// Segunda fuente: solo se usa si TMDB no trae nada o falla, para que las filas
// no se queden vacías. No agrega filas: rellena las que ya existen.
const CM = "https://cinemeta-catalogs.strem.io";

async function cinemeta(catalog, type, extra) {
  const url = CM + "/" + catalog + "/catalog/" + type + "/" + catalog + (extra || "") + ".json";
  const r = await kino.fetch(url);
  if (!r.ok) throw kino.error("unavailable", "Cinemeta respondió " + r.status);
  const d = await r.json();
  const metas = d && Array.isArray(d.metas) ? d.metas : [];
  return metas.map((m) => ({ m, kind: type === "movie" ? "movie" : "series" }));
}

function csItem(m, kind) {
  if (!m || !m.name) return null;
  const imdb = String(m.imdb_id || "");
  if (!/^tt\d{5,10}$/.test(imdb)) return null;
  const item = {
    id: imdb,
    ref: (kind === "movie" ? "movie:" : "tv:") + imdb,
    title: String(m.name).slice(0, 200),
    kind,
    ids: { imdb },
  };
  if (m.moviedb_id > 0) item.ids.tmdb = m.moviedb_id;
  const date = String(m.released || "");
  const year = /^\d{4}/.test(date) ? date.slice(0, 4) : String(m.year || "");
  if (/^\d{4}$/.test(year)) item.year = year;
  if (m.poster) item.poster = String(m.poster).replace("/small/", "/medium/");
  if (m.background) item.backdrop = String(m.background).replace("/small/", "/medium/");
  if (m.description) item.overview = String(m.description).slice(0, 2000);
  if (parseFloat(m.imdbRating) > 0) item.rating = Math.round(parseFloat(m.imdbRating) * 10) / 10;
  return item;
}

function csItems(list, limit) {
  const out = [];
  const seen = new Set();
  for (const { m, kind } of list) {
    const it = csItem(m, kind);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

function cinemetaItems(catalog, type, limit) {
  return cinemeta(catalog, type).then((list) => csItems(list, limit));
}

// "Novedades" de Cinemeta: el catálogo del año en curso, ordenado por fecha.
async function cinemetaRecent(limit) {
  const y = String(new Date().getFullYear());
  const [movies, series] = await Promise.all([
    cinemeta("year", "movie", "/genre=" + y),
    cinemeta("year", "series", "/genre=" + y),
  ]);
  const all = movies.concat(series);
  all.sort((a, b) => String(b.m.released || "").localeCompare(String(a.m.released || "")));
  return csItems(all, limit);
}

// TMDB primero; si falla o vuelve vacío, Cinemeta. Si Cinemeta también falla,
// el error sube y la fila muestra su aviso.
async function withFallback(primary, fallback) {
  try {
    const list = await primary();
    if (list && list.length) return list;
    kino.log("fuente principal sin datos, uso Cinemeta");
  } catch (e) {
    kino.log("fuente principal falló, uso Cinemeta:", errText(e));
  }
  return fallback();
}

function recentParams(kind, providers) {
  const isMovie = kind === "movie";
  const f = isMovie ? "primary_release_date" : "first_air_date";
  const params = { sort_by: "popularity.desc" };
  params[f + ".gte"] = day(-45);
  params[f + ".lte"] = day(0);
  if (providers) {
    params.watch_region = REGION;
    params.with_watch_providers = providers;
    params.with_watch_monetization_types = "flatrate";
  } else {
    // Sin filtro de plataforma: solo títulos con algo de votos, para no llenar
    // la fila de estrenos sin estrenar de verdad.
    params["vote_count.gte"] = 5;
  }
  return params;
}

// Primero pregunta por las plataformas. Si esa consulta falla o vuelve vacía
// (es la que no funcionaba en el televisor), pregunta por estrenos en general:
// así la fila siempre trae algo en vez de desaparecer.
async function premieres(kind, providers) {
  const path = "/discover/" + (kind === "movie" ? "movie" : "tv");
  try {
    const list = await raw(kind, path, recentParams(kind, providers));
    if (list.length) return list;
    kino.log("estrenos sin resultados por plataforma:", kind);
  } catch (e) {
    kino.log("estrenos falló por plataforma:", kind, errText(e));
  }
  if (!providers) return [];
  return raw(kind, path, recentParams(kind, null));
}

// Una sola fila de estrenos: películas y series de todas las plataformas,
// mezcladas por lo más popular.
async function estrenosTodas() {
  const [movies, series] = await Promise.all([
    premieres("movie", PROV.todas),
    premieres("series", PROV.todas),
  ]);
  const all = movies.concat(series);
  all.sort((a, b) => (b.r.popularity || 0) - (a.r.popularity || 0));
  return all;
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
  return {
    estrenos: [
      {
        id: "estrenos",
        title: t("Estrenos de todas las plataformas", "New on every platform"),
        load: () =>
          withFallback(
            async () => items(await estrenosTodas(), 20),
            () => cinemetaRecent(20)
          ),
      },
    ],
    vistas: [
      {
        id: "top-peliculas",
        title: t("Top 20 películas más vistas · v0.1.43", "Top 20 most watched movies · v0.1.43"),
        genre: "peliculas",
        load: () =>
          withFallback(
            async () => items(await trending("movie"), 20),
            () => cinemetaItems("top", "movie", 20)
          ),
      },
      {
        id: "top-series",
        title: t("Top 20 series más vistas", "Top 20 most watched series"),
        genre: "series",
        load: () =>
          withFallback(
            async () => items(await trending("series"), 20),
            () => cinemetaItems("top", "series", 20)
          ),
      },
    ],
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

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next;
      next = next + 1;
      out[i] = await fn(list[i], i);
    }
  }
  const workers = [];
  const n = Math.min(limit, list.length);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

function reasonText(e) {
  const c = e && e.code ? String(e.code) : "";
  if (c === "no_tmdb_key") return "falta la llave de TMDB";
  if (c === "rate_limited") return "TMDB limitó las peticiones";
  if (c === "timeout") return "TMDB tardó demasiado";
  if (c === "network") return "sin conexión con TMDB";
  if (c === "unavailable") return "TMDB no respondió";
  if (c === "invalid_request") return "consulta no aceptada";
  if (c === "too_large") return "respuesta muy grande";
  if (c === "vacia") return "sin resultados";
  return errText(e).slice(0, 60) || "error";
}

// Una fila que no se pudo cargar se muestra igual, con el motivo, en vez de
// desaparecer sin dejar rastro (que es lo que pasaba en el TV).
function noticeRow(d, reason) {
  kino.log("fila sin datos:", d.id, reason);
  return {
    id: d.id,
    title: ("Sin datos: " + reason + " · " + d.title).slice(0, 190),
    genre: d.genre,
    items: [
      {
        id: "aviso",
        ref: "movie:550",
        title: ("No se pudo cargar (" + reason + "). Reintenta en unos minutos.").slice(0, 200),
        kind: "movie",
        ids: { tmdb: 550 },
      },
    ],
  };
}

async function buildRows(defs) {
  const rows = await mapLimit(defs, CONCURRENCY, async (d) => {
    try {
      const list = await d.load();
      if (!list.length) return noticeRow(d, reasonText({ code: "vacia" }));
      const row = { id: d.id, title: d.title, items: list };
      if (d.genre) row.genre = d.genre;
      return row;
    } catch (e) {
      return noticeRow(d, reasonText(e));
    }
  });
  return rows.filter(Boolean);
}

export async function home() {
  const all = rowDefs();
  const order = ["vistas", "estrenos", "kdramas", "turcas"];
  const defs = [];
  for (const k of order) defs.push(...all[k]);
  return buildRows(defs);
}

export async function section({ tab }) {
  const all = rowDefs();
  const tabs = [
    { id: "vistas", label: t("Más vistas", "Most watched") },
    { id: "estrenos", label: t("Estrenos", "New") },
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
