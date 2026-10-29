const IMG = "https://image.tmdb.org/t/p/w500";
const BACKDROP = "https://image.tmdb.org/t/p/w780";
const STILL = "https://image.tmdb.org/t/p/w300";
const PROV = { netflix: "8", hbo: "1899|384", prime: "119|9", disney: "337" };

function lang() {
  return kino.lang === "en-US" ? "en-US" : "es-MX";
}
function t(es, en) {
  return kino.lang === "en-US" ? en : es;
}

async function tmdb(path, params) {
  await null;
  if (typeof kino.tmdb !== "function") {
    throw kino.error("unavailable", "kino.tmdb no existe", {
      userMessage: "Actualiza la aplicación para usar este plugin.",
    });
  }
  return kino.tmdb(path, params || {});
}

function item(m, type, rank) {
  const tv = type === "tv";
  const title = String(m.title || m.name || "").trim();
  if (!m.id || !title) return null;
  const year = String((tv ? m.first_air_date : m.release_date) || "").slice(0, 4);
  const out = {
    id: (tv ? "t-" : "m-") + m.id,
    ref: JSON.stringify({ kind: tv ? "tv" : "movie", id: m.id }),
    title,
    kind: tv ? "series" : "movie",
    ids: { tmdb: m.id },
  };
  if (/^\d{4}$/.test(year)) out.year = year;
  if (m.poster_path) out.poster = IMG + m.poster_path;
  if (m.backdrop_path) out.backdrop = BACKDROP + m.backdrop_path;
  if (m.overview) out.overview = String(m.overview);
  if (m.vote_average > 0) out.rating = Math.round(m.vote_average * 10) / 10;
  if (rank) out.badges = ["#" + rank];
  return out;
}

function toItems(results, typeOf) {
  const items = [];
  for (const m of results || []) {
    const type = typeOf(m);
    if (type !== "movie" && type !== "tv") continue;
    const it = item(m, type, items.length + 1);
    if (it) items.push(it);
    if (items.length >= 15) break;
  }
  return items;
}

async function trendingResults() {
  const pages = await Promise.all(
    ["1", "2", "3"].map((page) =>
      tmdb("/trending/all/day", { language: lang(), page }).catch(() => null)
    )
  );
  const results = [];
  for (const r of pages) if (r && r.results) results.push(...r.results);
  if (!results.length) throw kino.error("unavailable", "TMDB no devolvió tendencias");
  return results;
}

async function trendingRows() {
  const results = await trendingResults();
  return [
    {
      id: "tendencias-movie",
      title: t("Películas más vistas hoy", "Most watched movies today"),
      genre: "peliculas",
      items: toItems(results, (m) => (m.media_type === "movie" ? "movie" : null)),
    },
    {
      id: "tendencias-tv",
      title: t("Series más vistas hoy", "Most watched series today"),
      genre: "series",
      items: toItems(results, (m) => (m.media_type === "tv" ? "tv" : null)),
    },
  ];
}

async function kdramaRows() {
  const results = await trendingResults();
  const ko = results.filter((m) => m.media_type === "tv" && m.original_language === "ko");
  return [{ id: "kdramas", title: "K-dramas", genre: "doramas", items: toItems(ko, () => "tv") }];
}

async function estrenosRows() {
  const today = new Date().toISOString().slice(0, 10);
  const r = await tmdb("/movie/now_playing", { language: lang(), region: "MX", page: "1" });
  const list = (r.results || []).filter((m) => !m.release_date || m.release_date <= today);
  return [{ id: "estrenos", title: t("Estrenos en cines", "In theaters"), genre: "peliculas", items: toItems(list, () => "movie") }];
}

async function platformRows(key, name) {
  const one = async (type) => {
    const r = await tmdb("/discover/" + type, {
      watch_region: "MX",
      with_watch_providers: PROV[key],
      with_watch_monetization_types: "flatrate",
      sort_by: "popularity.desc",
      language: lang(),
      page: "1",
    });
    return {
      id: key + "-" + type,
      title: name + " · " + (type === "movie" ? t("Películas", "Movies") : "Series"),
      genre: type === "movie" ? "peliculas" : "series",
      items: toItems(r.results, () => type),
    };
  };
  return [await one("movie"), await one("tv")];
}

function clean(rows) {
  return rows.filter((r) => r && r.items && r.items.length);
}

export async function home() {
  await null;
  return clean(await trendingRows());
}

export async function section({ tab }) {
  await null;
  const tabs = [
    { id: "vistas", label: t("Más vistas", "Most watched") },
    { id: "estrenos", label: t("Estrenos", "New") },
    { id: "netflix", label: "Netflix" },
    { id: "hbo", label: "HBO Max" },
    { id: "prime", label: "Prime Video" },
    { id: "disney", label: "Disney+" },
    { id: "kdramas", label: "K-dramas" },
  ];
  const chosen = tabs.some((x) => x.id === tab) ? tab : "vistas";
  const names = { netflix: "Netflix", hbo: "HBO Max", prime: "Prime Video", disney: "Disney+" };
  let rows = [];
  try {
    if (chosen === "vistas") rows = await trendingRows();
    else if (chosen === "estrenos") rows = await estrenosRows();
    else if (chosen === "kdramas") rows = await kdramaRows();
    else rows = await platformRows(chosen, names[chosen]);
  } catch (e) {
    rows = [];
  }
  return { tabs, tab: chosen, rows: clean(rows) };
}

export async function episodes(ref) {
  await null;
  let r = null;
  try {
    r = JSON.parse(ref);
  } catch (e) {
    r = null;
  }
  if (!r || r.kind !== "tv" || !r.id) throw kino.error("not_found", "ref inválido");
  const language = lang();
  const show = await tmdb("/tv/" + r.id, { language });
  const seasons = (show.seasons || []).filter((s) => s.season_number > 0).slice(0, 10);
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
      if (e.overview) ep.overview = String(e.overview);
      if (e.still_path) ep.still = STILL + e.still_path;
      out.push(ep);
    }
  }
  return {
    series: { title: show.name, overview: show.overview || undefined, ids: { tmdb: r.id } },
    episodes: out,
  };
}

export async function resolve(ref) {
  await null;
  throw kino.error("not_found", "catálogo sin video", {
    userMessage: "Este catálogo no reproduce: busca el título en tus otras fuentes.",
  });
}