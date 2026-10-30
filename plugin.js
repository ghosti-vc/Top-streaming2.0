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

// ---------- JustWatch (el catálogo de la app de JustWatch) ----------
// Segunda fuente: se mezcla con TMDB. Una sola consulta GraphQL trae la lista
// completa; sus posters vienen como plantilla y hay que completarlos.
const JW = "https://apis.justwatch.com/graphql";
const JW_IMG = "https://images.justwatch.com";
const JW_QUERY =
  "query Top($country: Country!, $language: Language!, $first: Int!) {" +
  " popularTitles(country: $country, first: $first, sortBy: POPULAR, filter: {objectTypes: [%TYPES%]}) {" +
  "  edges { node { ... on MovieOrShow {" +
  "   objectId objectType" +
  "   content(country: $country, language: $language) {" +
  "    title originalReleaseYear originalReleaseDate posterUrl shortDescription" +
  "    scoring { imdbScore } externalIds { imdbId tmdbId }" +
  "   }" +
  "  } } }" +
  " }" +
  "}";

async function justwatch(types, first) {
  const key = "jw:" + types + ":" + first;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  await pace();
  const r = await kino.fetch(JW, {
    method: "POST",
    body: {
      json: {
        query: JW_QUERY.replace("%TYPES%", types),
        variables: { country: REGION, language: "es", first },
      },
    },
  });
  if (!r.ok) throw kino.error("unavailable", "JustWatch respondió " + r.status);
  const d = await r.json();
  if (d && Array.isArray(d.errors) && d.errors.length) {
    throw kino.error("unavailable", "JustWatch: " + String(d.errors[0].message || "consulta rechazada").slice(0, 120));
  }
  const edges = d && d.data && d.data.popularTitles && d.data.popularTitles.edges;
  const list = Array.isArray(edges) ? edges.map((e) => e && e.node).filter(Boolean) : [];
  memo.set(key, { at: Date.now(), data: list });
  return list;
}

// "/poster/123/{profile}/nombre.{format}" -> "https://images.justwatch.com/poster/123/s592/nombre.jpg"
function jwPoster(url) {
  const s = String(url || "");
  if (!s) return "";
  const path = s.replace("{profile}", "s592").replace("{format}", "jpg");
  if (/^https?:\/\//.test(path)) return path;
  return JW_IMG + (path.charAt(0) === "/" ? "" : "/") + path;
}

function jwItem(n) {
  const c = n && n.content;
  if (!c || !c.title) return null;
  const kind = n.objectType === "MOVIE" ? "movie" : n.objectType === "SHOW" ? "series" : "";
  if (!kind) return null;
  const ext = c.externalIds || {};
  const imdb = /^tt\d{5,10}$/.test(String(ext.imdbId || "")) ? String(ext.imdbId) : "";
  const tmdb = parseInt(ext.tmdbId, 10);
  const hasTmdb = Number.isFinite(tmdb) && tmdb > 0;
  const id = imdb || (hasTmdb ? "tmdb" + tmdb : "jw" + String(n.objectId || ""));
  const refId = imdb || (hasTmdb ? String(tmdb) : String(n.objectId || ""));
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(id) || !refId) return null;
  const item = {
    id,
    ref: (kind === "movie" ? "movie:" : "tv:") + refId,
    title: String(c.title).slice(0, 200),
    kind,
    ids: {},
  };
  if (imdb) item.ids.imdb = imdb;
  if (hasTmdb) item.ids.tmdb = tmdb;
  if (c.originalReleaseYear > 0) item.year = String(c.originalReleaseYear);
  const poster = jwPoster(c.posterUrl);
  if (poster) item.poster = poster;
  if (c.shortDescription) item.overview = String(c.shortDescription).slice(0, 2000);
  const score = c.scoring && c.scoring.imdbScore;
  if (score > 0) item.rating = Math.round(score * 10) / 10;
  return item;
}

function jwItems(nodes, limit) {
  const out = [];
  const seen = new Set();
  for (const n of nodes) {
    const it = jwItem(n);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

function justwatchItems(types, first, limit) {
  return justwatch(types, first).then((nodes) => jwItems(nodes, limit));
}

// "Estrenos" de JustWatch: su lista popular trae de todo, así que nos quedamos
// con lo que se estrenó en los últimos 45 días (el mismo plazo que usa TMDB).
async function justwatchRecent(limit) {
  const nodes = await justwatch("MOVIE, SHOW", 100);
  const from = day(-45);
  const to = day(0);
  const recent = nodes.filter((n) => {
    const date = String((n.content && n.content.originalReleaseDate) || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= from && date <= to;
  });
  recent.sort((a, b) => String(b.content.originalReleaseDate).localeCompare(String(a.content.originalReleaseDate)));
  return jwItems(recent, limit);
}

// ---------- Cinemeta (el catálogo de Stremio, hecho con datos de IMDb) ----------
// Tercera fuente: solo se usa si TMDB y JustWatch fallan. No agrega filas.
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

// Si la mezcla no trae nada, prueba la fuente de emergencia; si tampoco,
// el error sube y la fila muestra su aviso.
async function withFallback(primary, second, third) {
  const sources = [primary, second, third].filter(Boolean);
  for (let i = 0; i < sources.length; i++) {
    try {
      const list = await sources[i]();
      if (list && list.length) return list;
      kino.log("fuente " + (i + 1) + " sin datos, pruebo la siguiente");
    } catch (e) {
      kino.log("fuente " + (i + 1) + " falló, pruebo la siguiente:", errText(e));
    }
  }
  throw kino.error("unavailable", "ninguna fuente respondió");
}

// Para comparar títulos entre fuentes: minúsculas, sin acentos y sin signos.
function fold(text) {
  let s = String(text || "").toLowerCase();
  if (typeof s.normalize === "function") s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return s.replace(/[^a-z0-9]+/g, " ").trim();
}

// Dos títulos son el mismo si comparten id de TMDB, id de IMDb o título + año.
function itemKeys(it) {
  const keys = [];
  const ids = it.ids || {};
  if (ids.tmdb > 0) keys.push("tmdb:" + ids.tmdb);
  if (ids.imdb) keys.push("imdb:" + ids.imdb);
  const name = fold(it.title);
  if (name) keys.push("title:" + name + "|" + String(it.year || ""));
  return keys;
}

// Alterna un título de cada fuente (TMDB, JustWatch, TMDB…) y salta los
// repetidos. Si una fuente falla o viene vacía, la otra llena la fila sola.
function mergeItems(lists, limit) {
  const seen = new Set();
  const out = [];
  const at = lists.map(() => 0);
  let progressed = true;
  while (out.length < limit && progressed) {
    progressed = false;
    for (let l = 0; l < lists.length && out.length < limit; l++) {
      const list = lists[l];
      while (at[l] < list.length) {
        const it = list[at[l]];
        at[l] = at[l] + 1;
        const keys = itemKeys(it);
        if (keys.some((k) => seen.has(k))) continue;
        for (const k of keys) seen.add(k);
        out.push(it);
        progressed = true;
        break;
      }
    }
  }
  return out;
}

async function mixed(first, second, limit) {
  const lists = [];
  for (const fn of [first, second]) {
    try {
      const list = await fn();
      if (list && list.length) lists.push(list);
      else kino.log("una fuente vino vacía, sigo con la otra");
    } catch (e) {
      kino.log("una fuente falló, sigo con la otra:", errText(e));
    }
  }
  return mergeItems(lists, limit);
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
            () =>
              mixed(
                async () => items(await estrenosTodas(), 20),
                () => justwatchRecent(20),
                20
              ),
            null,
            () => cinemetaRecent(20)
          ),
      },
    ],
    vistas: [
      {
        id: "top-peliculas",
        title: t("Top 20 películas más vistas · v0.1.45", "Top 20 most watched movies · v0.1.45"),
        genre: "peliculas",
        load: () =>
          withFallback(
            () =>
              mixed(
                async () => items(await trending("movie"), 20),
                () => justwatchItems("MOVIE", 40, 20),
                20
              ),
            null,
            () => cinemetaItems("top", "movie", 20)
          ),
      },
      {
        id: "top-series",
        title: t("Top 20 series más vistas", "Top 20 most watched series"),
        genre: "series",
        load: () =>
          withFallback(
            () =>
              mixed(
                async () => items(await trending("series"), 20),
                () => justwatchItems("SHOW", 40, 20),
                20
              ),
            null,
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
  if (c === "rate_limited") return "la fuente limitó las peticiones";
  if (c === "timeout") return "la fuente tardó demasiado";
  if (c === "network") return "sin conexión";
  if (c === "unavailable") {
    return /ninguna fuente/.test(String((e && e.message) || "")) ? "ninguna fuente respondió" : "la fuente no respondió";
  }
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
