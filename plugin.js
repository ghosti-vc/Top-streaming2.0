// Top Streaming 2.0: lo más visto de las plataformas de streaming, por país.
// Los datos salen de TMDB a través de kino.tmdb (sin ninguna llave en el código).
// Cada fila muestra el Top 10. Máximo ~16 llamadas a TMDB por cada carga del Inicio.

const IMG = "https://image.tmdb.org/t/p/w500";
const BACKDROP = "https://image.tmdb.org/t/p/w780";
const STILL = "https://image.tmdb.org/t/p/w300";

const CACHE_MS = 30 * 60 * 1000; // el Inicio se guarda 30 minutos (menos llamadas a TMDB)
const PER_ROW = 10;
const MAX_SEASONS = 10;

// Ids de plataforma en TMDB (casi nunca cambian). Si alguno no da resultados en tu país,
// se puede revisar en themoviedb.org (sección "Dónde ver").
const PLATFORMS = [
  { id: "netflix", name: "Netflix", ids: "8" },
  { id: "prime", name: "Prime Video", ids: "119" },
  { id: "disney", name: "Disney+", ids: "337" },
  { id: "hbo", name: "HBO Max", ids: "384|1899" },
  { id: "apple", name: "Apple TV+", ids: "350" },
];

const english = () => kino.lang === "en-US";
const tmdbLang = () => (english() ? "en-US" : "es-MX");
const region = () => String(kino.config.get("region") || "MX").trim().toUpperCase();
const available = (name) => (english() ? "Streaming on: " : "Disponible en: ") + name;

async function tmdb(path, params) {
  await null; // primero await, luego validar (Kino 0.9.49 y anteriores)
  if (typeof kino.tmdb !== "function") {
    throw kino.error("unavailable", "kino.tmdb no existe", {
      userMessage: "Actualiza la aplicación para usar este plugin.",
    });
  }
  return kino.tmdb(path, params || {});
}

// Lee y convierte a JSON lo guardado; si algo sale mal devuelve null (nunca rompe).
async function readJSON(key) {
  try {
    const v = await kino.storage.get(key);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}

function item(m, type, rank, label) {
  const tv = type === "tv";
  const title = String(m.title || m.name || "").trim();
  if (!m.id || !title) return null;
  const year = String((tv ? m.first_air_date : m.release_date) || "").slice(0, 4);
  const out = {
    id: (tv ? "t-" : "m-") + m.id,
    ref: JSON.stringify({ kind: tv ? "tv" : "movie", id: m.id }),
    title,
    kind: tv ? "series" : "movie",
    genres: [tv ? "series" : "peliculas"],
    ids: { tmdb: m.id },
  };
  if (/^\d{4}$/.test(year)) out.year = Number(year);
  if (m.poster_path) out.poster = IMG + m.poster_path;
  if (m.backdrop_path) out.backdrop = BACKDROP + m.backdrop_path;
  const overview = (label ? label + (m.overview ? "\n\n" : "") : "") + String(m.overview || "");
  if (overview) out.overview = overview.slice(0, 2000);
  if (m.vote_average > 0) out.rating = Math.round(m.vote_average * 10) / 10;
  out.badges = ["#" + rank];
  return out;
}

function toItems(results, type, label) {
  const items = [];
  for (const m of results || []) {
    const it = item(m, type, items.length + 1, label);
    if (it) items.push(it);
    if (items.length >= PER_ROW) break;
  }
  return items;
}

function byPopularity(list) {
  return (list || []).slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

// 2 llamadas: tendencias de hoy (películas y series).
async function trendingRows() {
  const language = tmdbLang();
  const [movies, shows] = await Promise.all([
    tmdb("/trending/movie/day", { language, page: "1" }).catch(() => null),
    tmdb("/trending/tv/day", { language, page: "1" }).catch(() => null),
  ]);
  if (!movies && !shows) throw kino.error("unavailable", "TMDB no devolvió tendencias");
  return [
    {
      id: "tendencias-movie",
      title: english() ? "Most watched movies today" : "Películas más vistas hoy",
      genre: "peliculas",
      items: toItems(movies && movies.results, "movie"),
    },
    {
      id: "tendencias-tv",
      title: english() ? "Most watched series today" : "Series más vistas hoy",
      genre: "series",
      items: toItems(shows && shows.results, "tv"),
    },
  ];
}

// 1 llamada (2 si la primera falla): películas en cines ahora en tu país.
async function estrenosRow() {
  const language = tmdbLang();
  const today = new Date().toISOString().slice(0, 10);
  let results = [];
  try {
    const r = await tmdb("/movie/now_playing", { language, region: region(), page: "1" });
    results = (r.results || []).filter((m) => !m.release_date || m.release_date <= today);
  } catch (e) {
    kino.log("top-streaming: now_playing falló", (e && e.code) || "error");
  }
  if (!results.length) {
    const from = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const r = await tmdb("/discover/movie", {
      "primary_release_date.gte": from,
      "primary_release_date.lte": today,
      sort_by: "popularity.desc",
      include_adult: "false",
      language,
      page: "1",
    });
    results = r.results || [];
  }
  return {
    id: "estrenos",
    title: english() ? "New releases" : "Estrenos",
    genre: "peliculas",
    items: toItems(byPopularity(results), "movie"),
  };
}

// 1 llamada (2 si la primera falla): K-dramas.
async function kdramaRow() {
  const language = tmdbLang();
  let results = [];
  try {
    const r = await tmdb("/discover/tv", {
      with_original_language: "ko",
      with_origin_country: "KR",
      with_genres: "18",
      sort_by: "popularity.desc",
      include_adult: "false",
      language,
      page: "1",
    });
    results = r.results || [];
  } catch (e) {
    kino.log("top-streaming: discover de K-dramas falló", (e && e.code) || "error");
  }
  if (!results.length) {
    const r = await tmdb("/trending/tv/day", { language, page: "1" });
    results = (r.results || []).filter((m) => m.original_language === "ko");
  }
  return {
    id: "kdramas",
    title: "Top " + PER_ROW + " K-dramas",
    genre: "series",
    items: toItems(results, "tv"),
  };
}

// 2 llamadas: estrenos de los últimos 60 días en Netflix (películas y series).
async function netflixNewRows() {
  const language = tmdbLang();
  const day = 24 * 60 * 60 * 1000;
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 60 * day).toISOString().slice(0, 10);
  const base = {
    watch_region: region(),
    with_watch_providers: "8",
    with_watch_monetization_types: "flatrate",
    sort_by: "popularity.desc",
    include_adult: "false",
    language,
    page: "1",
  };
  const [movies, shows] = await Promise.all([
    tmdb("/discover/movie", Object.assign({}, base, { "primary_release_date.gte": from, "primary_release_date.lte": today })).catch(() => null),
    tmdb("/discover/tv", Object.assign({}, base, { "first_air_date.gte": from, "first_air_date.lte": today })).catch(() => null),
  ]);
  const label = available("Netflix");
  return [
    {
      id: "netflix-estrenos-movie",
      title: english() ? "New on Netflix · Movies" : "Estrenos en Netflix · Películas",
      genre: "peliculas",
      items: toItems(byPopularity(movies && movies.results), "movie", label),
    },
    {
      id: "netflix-estrenos-tv",
      title: english() ? "New on Netflix · Series" : "Estrenos en Netflix · Series",
      genre: "series",
      items: toItems(byPopularity(shows && shows.results), "tv", label),
    },
  ];
}

// 1 llamada por plataforma y tipo.
async function platformRow(p, type) {
  const r = await tmdb("/discover/" + type, {
    watch_region: region(),
    with_watch_providers: p.ids,
    with_watch_monetization_types: "flatrate",
    sort_by: "popularity.desc",
    include_adult: "false",
    language: tmdbLang(),
    page: "1",
  });
  const kindWord = type === "movie" ? (english() ? "movies" : "películas") : "series";
  return {
    id: p.id + "-" + type,
    title: p.name + " · Top " + PER_ROW + " " + kindWord,
    genre: type === "movie" ? "peliculas" : "series",
    items: toItems(r.results, type, available(p.name)),
  };
}

async function build() {
  const jobs = [trendingRows(), estrenosRow(), netflixNewRows(), kdramaRow()];
  for (const p of PLATFORMS) {
    jobs.push(platformRow(p, "movie"));
    jobs.push(platformRow(p, "tv"));
  }
  let firstError = null;
  const results = await Promise.all(
    jobs.map((job) =>
      job.catch((e) => {
        if (!firstError) firstError = e;
        kino.log("top-streaming: una fila falló", (e && e.code) || "error");
        return null;
      })
    )
  );
  const rows = [].concat(...results.map((r) => (Array.isArray(r) ? r : [r]))).filter((r) => r && r.items && r.items.length);
  if (!rows.length) throw firstError || kino.error("unavailable", "TMDB no devolvió títulos");
  return rows.slice(0, 20); // Kino acepta máximo 20 filas
}

export async function home() {
  await null;
  const scope = region() + ":" + kino.lang;
  const cached = await readJSON("home:" + scope);
  if (cached) return cached;
  try {
    const rows = await build();
    const text = JSON.stringify(rows);
    kino.storage.set("home:" + scope, text, { ttlMs: CACHE_MS });
    kino.storage.set("last:" + scope, text);
    return rows;
  } catch (e) {
    kino.log("top-streaming: home falló", (e && e.code) || String(e));
    // Sin llave de TMDB no hay copia útil: dejamos que Kino muestre su aviso.
    if (e && e.code === "no_tmdb_key") throw e;
    const last = await readJSON("last:" + scope);
    if (last) return last;
    throw e;
  }
}

// Las series necesitan "episodes" para que Kino no las descarte; se arma con las temporadas de TMDB.
export async function episodes(ref) {
  await null;
  let r = null;
  try {
    r = JSON.parse(ref);
  } catch (e) {
    r = null;
  }
  if (!r || r.kind !== "tv" || !r.id) throw kino.error("not_found", "ref inválido");
  const language = tmdbLang();
  const show = await tmdb("/tv/" + r.id, { language });
  const seasons = (show.seasons || []).filter((s) => s.season_number > 0).slice(0, MAX_SEASONS);
  const full = await Promise.all(
    seasons.map((s) => tmdb("/tv/" + r.id + "/season/" + s.season_number, { language }).catch(() => null))
  );
  const out = [];
  for (const season of full) {
    if (!season) continue;
    for (const e of season.episodes || []) {
      if (!(e.episode_number >= 1)) continue;
      const ep = {
        season: e.season_number,
        number: e.episode_number,
        ref: JSON.stringify({ kind: "tv", id: r.id, s: e.season_number, e: e.episode_number }),
      };
      if (e.name) ep.title = String(e.name);
      if (e.overview) ep.overview = String(e.overview).slice(0, 2000);
      if (e.still_path) ep.still = STILL + e.still_path;
      if (/^\d{4}-\d{2}-\d{2}$/.test(e.air_date || "")) ep.airDate = e.air_date;
      if (e.runtime >= 1 && e.runtime <= 1000) ep.runtimeMinutes = e.runtime;
      out.push(ep);
    }
  }
  return {
    series: { title: show.name, overview: show.overview ? String(show.overview).slice(0, 2000) : undefined, ids: { tmdb: r.id } },
    episodes: out,
  };
}

// Solo lo llama un Kino 0.9.53 o anterior: de 0.9.54 en adelante "catalogOnly" manda al usuario a sus otras fuentes.
export async function resolve(ref) {
  await null;
  throw kino.error("not_found", "catálogo sin video", {
    userMessage: "Este catálogo no reproduce: busca el título en tus otras fuentes.",
  });
}
