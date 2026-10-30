const IMG = "https://image.tmdb.org/t/p/";
const LANG = "es-MX";
const REGION = "MX";
const MEMO_MS = 10 * 60 * 1000;
const ROW_LIMIT = 20;
const CONCURRENCY = 4;
const SOFT_DEADLINE_MS = 15000;

const PROV = {
  netflix: "8",
  prime: "119|9",
  todas: "8|1899|384|119|9|337",
};

const GENRES = {
  28: "accion",
  12: "aventura",
  16: "animacion",
  35: "comedia",
  80: "crimen",
  99: "documentales",
  18: "drama",
  10751: "familia",
  14: "fantasia",
  36: "historia",
  27: "terror",
  10402: "musical",
  9648: "misterio",
  10749: "romance",
  878: "ciencia-ficcion",
  53: "suspenso",
  10752: "belica",
  37: "western",
  10759: "accion",
  10765: "ciencia-ficcion",
  10762: "infantil",
  10763: "noticias",
  10764: "reality",
  10766: "drama",
  10767: "entretenimiento",
  10768: "belica",
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

function transient(e) {
  const c = e && e.code;
  return c === "rate_limited" || c === "timeout" || c === "network" || c === "unavailable";
}

function hasTmdb() {
  return typeof kino.tmdb === "function";
}

async function tmdb(path, params) {
  await null;
  if (!hasTmdb()) {
    throw kino.error("unavailable", "kino.tmdb no existe en este Kino", {
      userMessage: "Actualiza Kino para ver este catálogo.",
    });
  }
  const p = Object.assign({ language: LANG }, params || {});
  const key = path + "?" + JSON.stringify(p);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.data;
  const data = await kino.tmdb(path, p);
  if (memo.size > 120) memo.clear();
  memo.set(key, { at: Date.now(), data: data });
  return data;
}

async function withRetry(fn, deadline) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!transient(e)) throw e;
      if (Date.now() + 900 > deadline) throw e;
      await kino.sleep(attempt === 0 ? 350 : 1200);
    }
  }
  throw last;
}

function day(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function itemGenres(r) {
  const ids = Array.isArray(r.genre_ids) ? r.genre_ids : [];
  const out = [];
  for (let i = 0; i < ids.length && out.length < 5; i++) {
    const g = GENRES[ids[i]];
    if (g && out.indexOf(g) === -1) out.push(g);
  }
  return out;
}

function toItem(r, kind) {
  const title = r && (r.title || r.name);
  if (!title || !r.id) return null;
  const date = String(r.release_date || r.first_air_date || "");
  const item = {
    id: (kind === "movie" ? "m" : "s") + r.id,
    ref: (kind === "movie" ? "movie:" : "tv:") + r.id,
    title: String(title).slice(0, 200),
    kind: kind,
    ids: { tmdb: r.id },
  };
  if (/^\d{4}/.test(date)) item.year = date.slice(0, 4);
  if (r.poster_path) item.poster = IMG + "w500" + r.poster_path;
  if (r.backdrop_path) item.backdrop = IMG + "w780" + r.backdrop_path;
  if (r.overview) item.overview = String(r.overview).slice(0, 2000);
  if (r.vote_average > 0) item.rating = Math.round(r.vote_average * 10) / 10;
  const genres = itemGenres(r);
  if (genres.length) item.genres = genres;
  return item;
}

async function raw(kind, path, params) {
  const d = await tmdb(path, params);
  const results = Array.isArray(d) ? d : d && Array.isArray(d.results) ? d.results : [];
  return results.map(function (r) {
    return { r: r, kind: kind };
  });
}

function items(list, limit) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const it = toItem(list[i].r, list[i].kind);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

function discover(kind, params) {
  const isMovie = kind === "movie";
  const p = Object.assign({ sort_by: "popularity.desc" }, params || {});
  if (isMovie) p.region = REGION;
  return raw(kind, "/discover/" + (isMovie ? "movie" : "tv"), p);
}

function premieres(kind, providers, days) {
  const isMovie = kind === "movie";
  const f = isMovie ? "primary_release_date" : "first_air_date";
  const params = {
    watch_region: REGION,
    with_watch_providers: providers,
    with_watch_monetization_types: "flatrate",
  };
  params[f + ".gte"] = day(-days);
  params[f + ".lte"] = day(0);
  return discover(kind, params);
}

function popular(kind, providers) {
  return discover(kind, {
    watch_region: REGION,
    with_watch_providers: providers,
    with_watch_monetization_types: "flatrate",
  });
}

function onPlatform(kind, providers) {
  return [
    function () {
      return premieres(kind, providers, 45);
    },
    function () {
      return premieres(kind, providers, 365);
    },
    function () {
      return popular(kind, providers);
    },
  ];
}

function trending(kind) {
  return raw(kind, "/trending/" + (kind === "movie" ? "movie" : "tv") + "/day", {});
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
  function platform(key, name) {
    return [
      {
        id: key + "-pelis",
        title: t("Películas de estreno en " + name, "New movies on " + name),
        genre: "peliculas",
        tiers: onPlatform("movie", PROV[key]),
      },
      {
        id: key + "-series",
        title: t("Series de estreno en " + name, "New series on " + name),
        genre: "series",
        tiers: onPlatform("series", PROV[key]),
      },
    ];
  }
  return {
    estrenos: [
      {
        id: "estrenos-pelis",
        title: t("Películas de estreno", "New movies"),
        genre: "peliculas",
        tiers: onPlatform("movie", PROV.todas),
      },
      {
        id: "estrenos-series",
        title: t("Series de estreno", "New series"),
        genre: "series",
        tiers: onPlatform("series", PROV.todas),
      },
    ],
    vistas: [
      {
        id: "top-peliculas",
        title: t("Top 20 películas más vistas", "Top 20 most watched movies"),
        genre: "peliculas",
        tiers: [
          function () {
            return trending("movie");
          },
        ],
      },
      {
        id: "top-series",
        title: t("Top 20 series más vistas", "Top 20 most watched series"),
        genre: "series",
        tiers: [
          function () {
            return trending("series");
          },
        ],
      },
    ],
    netflix: platform("netflix", "Netflix"),
    prime: platform("prime", "Prime Video"),
    kdramas: [
      {
        id: "top-kdramas",
        title: t("Top 20 K-dramas más vistos", "Top 20 most watched K-dramas"),
        genre: "doramas",
        tiers: [
          function () {
            return kdramas();
          },
        ],
      },
    ],
    turcas: [
      {
        id: "top-turcas",
        title: t("Top 20 series turcas", "Top 20 Turkish series"),
        genre: "series",
        tiers: [
          function () {
            return turcas();
          },
        ],
      },
    ],
  };
}

async function loadTiers(tiers, deadline) {
  let lastError = null;
  for (let i = 0; i < tiers.length; i++) {
    if (Date.now() >= deadline) {
      throw kino.error("timeout", "se acabó el tiempo para cargar la fila");
    }
    try {
      const list = items(await withRetry(tiers[i], deadline), ROW_LIMIT);
      if (list.length) return list;
    } catch (e) {
      lastError = e;
      if (!transient(e)) throw e;
    }
  }
  if (lastError) throw lastError;
  return [];
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

async function buildRows(defs, deadline) {
  const errors = [];
  const rows = await mapLimit(defs, CONCURRENCY, async function (d) {
    try {
      const list = await loadTiers(d.tiers, deadline);
      if (!list.length) return null;
      const row = { id: d.id, title: d.title, items: list };
      if (d.genre) row.genre = d.genre;
      return row;
    } catch (e) {
      errors.push(d.id + ": " + errText(e));
      return null;
    }
  });
  if (errors.length) {
    throw kino.error("unavailable", errors.join(" | ").slice(0, 190));
  }
  return rows.filter(Boolean);
}

export async function home() {
  await null;
  const all = rowDefs();
  const order = ["vistas", "estrenos", "netflix", "prime", "kdramas", "turcas"];
  const defs = [];
  for (let i = 0; i < order.length; i++) {
    const group = all[order[i]];
    for (let j = 0; j < group.length; j++) defs.push(group[j]);
  }
  return buildRows(defs, Date.now() + SOFT_DEADLINE_MS);
}

export async function section(arg) {
  await null;
  const tab = arg && arg.tab;
  const all = rowDefs();
  const tabs = [
    { id: "vistas", label: t("Más vistas", "Most watched") },
    { id: "estrenos", label: t("Estrenos", "New") },
    { id: "netflix", label: "Netflix" },
    { id: "prime", label: "Prime Video" },
    { id: "kdramas", label: "K-dramas" },
    { id: "turcas", label: t("Series turcas", "Turkish series") },
  ];
  let chosen = "vistas";
  for (let i = 0; i < tabs.length; i++) {
    if (tabs[i].id === tab) chosen = tab;
  }
  return {
    tabs: tabs,
    tab: chosen,
    rows: await buildRows(all[chosen], Date.now() + SOFT_DEADLINE_MS),
  };
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
