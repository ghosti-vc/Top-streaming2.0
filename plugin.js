const IMG = "https://image.tmdb.org/t/p/";
const LANG = "es-MX";
const REGION = "MX";
const TTL_MS = 10 * 60 * 1000;
const PROV = {
  netflix: "8",
  prime: "119|9",
  todas: "8|1899|384|119|9|337",
};

// Respaldo: se usa solo si TMDB falla o llega vacío.
const RT = "https://www.rottentomatoes.com/browse/movies_at_home/";
const RT_URL = {
  vistas: RT + "sort:popular",
  nuevas: RT + "sort:newest",
  netflix: RT + "affiliates:netflix~sort:popular",
  prime: RT + "affiliates:prime-video~sort:popular",
};
const TVM = "https://api.tvmaze.com";
const DAYS_WEB = 7;
const DAYS_COUNTRY = 4;

const memo = new Map();
const pending = new Map();

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

// ---------- Respaldo ----------

// Guarda la promesa (no el dato) para que filas que piden lo mismo a la vez
// hagan una sola petición. Si falla, no se queda guardada.
function cached(key, fn) {
  const hit = pending.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = fn();
  pending.set(key, { at: Date.now(), p });
  p.catch(() => {
    const cur = pending.get(key);
    if (cur && cur.p === p) pending.delete(key);
  });
  return p;
}

async function getText(url, accept) {
  await null;
  const r = await kino.fetch(url, {
    headers: { Accept: accept },
    timeoutMs: 12000,
  });
  if (!r.ok) throw kino.error("unavailable", "respaldo http " + r.status);
  return r.text();
}

function decodeHtml(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Rotten Tomatoes: películas. Lee el HTML de la página; tolera cambios leves
// (si no hay título en la tarjeta, lo arma con el nombre de la dirección).
function rtParse(html) {
  let blocks = String(html)
    .split(/(?=<tile-dynamic\b)/i)
    .filter((b) => /^<tile-dynamic\b/i.test(b));
  if (blocks.length < 2) {
    blocks = String(html)
      .split(/(?=<a\b[^>]*href="[^"]*\/m\/)/i)
      .filter((b) => /^<a\b/i.test(b));
  }
  const out = [];
  const seen = new Set();
  for (const b of blocks) {
    const sm = /\/m\/([a-z0-9_]+)/i.exec(b);
    if (!sm) continue;
    const slug = sm[1].toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    const tm = /data-qa="discovery-media-list-item-title"[^>]*>\s*([^<]+?)\s*</i.exec(b);
    const title = tm
      ? decodeHtml(tm[1])
      : slug
          .replace(/_\d{4}$/, "")
          .replace(/_/g, " ")
          .replace(/\b[a-z]/g, (c) => c.toUpperCase());
    if (!title) continue;
    const it = {
      id: "rt-" + slug,
      ref: "movie:rt:" + slug,
      title: title.slice(0, 200),
      kind: "movie",
    };
    const ym = /_(\d{4})$/.exec(slug);
    if (ym) it.year = ym[1];
    const pm = /<rt-img\b[^>]*\ssrc="(https:\/\/[^"]+)"/i.exec(b);
    if (pm) it.poster = decodeHtml(pm[1]);
    out.push(it);
  }
  return out;
}

async function rtMovies(url) {
  const html = await cached(url, () => getText(url, "text/html"));
  return rtParse(html).slice(0, 20);
}

// TVMaze: series (gratis, sin clave).
async function tvmEpisodes(base, days, extra) {
  const urls = [];
  for (let i = 0; i < days; i++) urls.push(base + "?date=" + day(-i) + (extra || ""));
  let ok = 0;
  const eps = [];
  await Promise.all(
    urls.map(async (u) => {
      try {
        const d = await cached(u, async () => JSON.parse(await getText(u, "application/json")));
        if (Array.isArray(d)) {
          ok++;
          for (const e of d) eps.push(e);
        }
      } catch (e) {
        // un día que falla no tumba el resto
      }
    })
  );
  if (!ok) throw kino.error("unavailable", "tvmaze sin datos");
  return eps;
}

function tvmShow(e) {
  return e && ((e._embedded && e._embedded.show) || e.show);
}

function tvmItem(s) {
  const item = {
    id: "tvm" + s.id,
    ref: "tv:tvmaze:" + s.id,
    title: String(s.name).slice(0, 200),
    kind: "series",
  };
  if (s.premiered && /^\d{4}/.test(s.premiered)) item.year = s.premiered.slice(0, 4);
  const img = s.image && (s.image.original || s.image.medium);
  if (img) item.poster = String(img).replace(/^http:/, "https:");
  if (s.summary) item.overview = decodeHtml(String(s.summary).replace(/<[^>]*>/g, "")).slice(0, 2000);
  if (s.rating && s.rating.average > 0) item.rating = Math.round(s.rating.average * 10) / 10;
  if (s.externals && s.externals.imdb) item.ids = { imdb: s.externals.imdb };
  return item;
}

function tvmPick(eps, o) {
  const byId = new Map();
  for (const e of eps) {
    const s = tvmShow(e);
    if (!s || !s.id || !s.name) continue;
    if (o.premieres && e.number !== 1) continue;
    if (o.channel) {
      const w = (s.webChannel && s.webChannel.name) || (s.network && s.network.name) || "";
      if (!o.channel.test(w)) continue;
    }
    if (o.language && s.language !== o.language) continue;
    if (o.scripted && s.type !== "Scripted") continue;
    if (!byId.has(s.id)) byId.set(s.id, s);
  }
  return Array.from(byId.values())
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, 20)
    .map(tvmItem);
}

async function tvmSeries(o) {
  const eps = await tvmEpisodes(TVM + "/schedule/web", DAYS_WEB, "");
  return tvmPick(eps, o);
}

async function tvmCountry(country, language) {
  const eps = await tvmEpisodes(TVM + "/schedule", DAYS_COUNTRY, "&country=" + country);
  return tvmPick(eps, { language, scripted: true });
}

// ---------- Filas ----------

function rowDefs() {
  const platform = (key, name, rtUrl, channel) => [
    {
      id: key + "-pelis",
      title: t("Películas de estreno en " + name, "New movies on " + name),
      genre: "peliculas",
      load: async () => items(await premieres("movie", PROV[key]), 20),
      fallback: () => rtMovies(rtUrl),
    },
    {
      id: key + "-series",
      title: t("Series de estreno en " + name, "New series on " + name),
      genre: "series",
      load: async () => items(await premieres("series", PROV[key]), 20),
      fallback: () => tvmSeries({ premieres: true, channel }),
    },
  ];
  return {
    estrenos: [
      {
        id: "estrenos-pelis",
        title: t("Películas de estreno", "New movies"),
        genre: "peliculas",
        load: async () => items(await premieres("movie", PROV.todas), 20),
        fallback: () => rtMovies(RT_URL.nuevas),
      },
      {
        id: "estrenos-series",
        title: t("Series de estreno", "New series"),
        genre: "series",
        load: async () => items(await premieres("series", PROV.todas), 20),
        fallback: () => tvmSeries({ premieres: true }),
      },
    ],
    vistas: [
      {
        id: "top-peliculas",
        title: t("Top 20 películas más vistas", "Top 20 most watched movies"),
        genre: "peliculas",
        load: async () => items(await trending("movie"), 20),
        fallback: () => rtMovies(RT_URL.vistas),
      },
      {
        id: "top-series",
        title: t("Top 20 series más vistas", "Top 20 most watched series"),
        genre: "series",
        load: async () => items(await trending("series"), 20),
        fallback: () => tvmSeries({ premieres: false }),
      },
    ],
    netflix: platform("netflix", "Netflix", RT_URL.netflix, /netflix/i),
    prime: platform("prime", "Prime Video", RT_URL.prime, /prime|amazon/i),
    kdramas: [
      {
        id: "top-kdramas",
        title: t("Top 20 K-dramas más vistos", "Top 20 most watched K-dramas"),
        genre: "doramas",
        load: async () => items(await kdramas(), 20),
        fallback: () => tvmCountry("KR", "Korean"),
      },
    ],
    turcas: [
      {
        id: "top-turcas",
        title: t("Top 20 series turcas", "Top 20 Turkish series"),
        genre: "series",
        load: async () => items(await turcas(), 20),
        fallback: () => tvmCountry("TR", "Turkish"),
      },
    ],
  };
}

async function buildRows(defs) {
  const errs = [];
  const rows = await Promise.all(
    defs.map(async (d) => {
      let list = [];
      let why = "";
      try {
        list = await d.load();
        if (!list.length) why = "vacia";
      } catch (e) {
        why = errText(e);
      }
      if (!list.length && d.fallback) {
        try {
          list = await d.fallback();
          if (list.length) kino.log("respaldo usado: " + d.id);
          else why += " | respaldo vacio";
        } catch (e) {
          why += " | respaldo " + errText(e);
        }
      }
      if (!list.length) {
        errs.push(d.id + ": " + why);
        return null;
      }
      const row = { id: d.id, title: d.title, items: list };
      if (d.genre) row.genre = d.genre;
      return row;
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
