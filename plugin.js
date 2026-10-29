// Top Streaming 2.0 - catálogo de TMDB (sin llave en el código: usa kino.tmdb, Kino 0.9.53+).
const IMG = "https://image.tmdb.org/t/p/";
const LANG = "es-MX";
const REGION = "MX";
const TTL_MS = 60 * 1000;
const PROV = {
  netflix: "8",
  hbo: "1899|384",
  prime: "119|9",
  disney: "337",
  todas: "8|1899|384|119|9|337",
};

const memo = new Map();

function en() {
  return kino.lang === "en-US";
}
function t(es, enText) {
  return en() ? enText : es;
}

async function tmdb(path, params) {
  await null; // primero await, luego validar
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
  kino.log(
    "tmdb " + path + " -> " + typeof data + " " +
      (data && typeof data === "object" ? Object.keys(data).slice(0, 6).join(",") : "")
  );
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
  return raw(kind, "/trending/" + (kind === "movie" ? "movie" : "tv") + "/day", { region: REGION });
}

function premieres(kind, providers) {
  const isMovie = kind === "movie";
  const f = isMovie ? "primary_release_date" : "first_air_date";
  const params = {
    watch_region: REGION,
    with_watch_providers: providers,
    with_watch_monetization_types: "flatrate",
    sort_by: "popularity.desc",
    region: REGION,
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

function popular(list) {
  return list.slice().sort((a, b) => (b.r.popularity || 0) - (a.r.popularity || 0));
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
        id: "estrenos-todas",
        title: t("Estrenos en todas las plataformas", "New on every platform"),
        load: async () => {
          const [m, s] = await Promise.all([premieres("movie", PROV.todas), premieres("series", PROV.todas)]);
          return items(popular(m.concat(s)), 20);
        },
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
    hbo: platform("hbo", "HBO Max"),
    prime: platform("prime", "Prime Video"),
    disney: platform("disney", "Disney+"),
    kdramas: [
      {
        id: "top-kdramas",
        title: t("Top 20 K-dramas más vistos", "Top 20 most watched K-dramas"),
        genre: "doramas",
        load: async () => items(await kdramas(), 20),
      },
    ],
  };
}

async function buildRows(defs) {
  const rows = await Promise.all(
    defs.map(async (d) => {
      try {
        const list = await d.load();
        if (!list.length) {
          kino.log("fila " + d.id + " vacía");
          return null;
        }
        const row = { id: d.id, title: d.title, items: list };
        if (d.genre) row.genre = d.genre;
        return row;
      } catch (e) {
        kino.log(
          "fila " + d.id + " falló: " +
            (e && (e.code || e.message) ? (e.code || "") + " " + (e.message || "") : String(e))
        );
        return null;
      }
    })
  );
  return rows.filter(Boolean);
}

export async function home() {
  const all = rowDefs();
  const order = ["estrenos", "vistas", "netflix", "hbo", "prime", "disney", "kdramas"];
  const defs = [];
  for (const k of order) defs.push(...all[k]);
  return buildRows(defs);
}

export async function section({ tab }) {
  const all = rowDefs();
  const tabs = [
    { id: "estrenos", label: t("Estrenos", "New") },
    { id: "vistas", label: t("Más vistas", "Most watched") },
    { id: "netflix", label: "Netflix" },
    { id: "hbo", label: "HBO Max" },
    { id: "prime", label: "Prime Video" },
    { id: "disney", label: "Disney+" },
    { id: "kdramas", label: "K-dramas" },
  ];
  const chosen = tabs.some((x) => x.id === tab) ? tab : "estrenos";
  return { tabs, tab: chosen, rows: await buildRows(all[chosen]) };
}

export async function episodes(ref) {
  await null;
  return { episodes: [] };
}

export async function resolve(ref) {
  await null;
  throw kino.error("not_found", "solo catálogo", {
    userMessage: "Este catálogo no reproduce: busca el título en tus otras fuentes.",
  });
}