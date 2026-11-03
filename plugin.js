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

/* ---------- Para Ti ---------- */

// Lee el historial de lo que viste. Prueba kino.history y kino.storage;
// si la app no ofrece ninguno, devuelve [] y la fila usa lo popular.
async function readHistory() {
  try {
    let h = null;
    if (kino.history && typeof kino.history.list === "function") {
      h = await kino.history.list();
    } else if (kino.storage && typeof kino.storage.get === "function") {
      h = await kino.storage.get("history");
    }
    if (!Array.isArray(h)) return [];
    const out = [];
    for (const e of h) {
      let kind = e && e.kind;
      let id = e && ((e.ids && e.ids.tmdb) || e.tmdb);
      const ref = e && typeof e.ref === "string" ? e.ref : "";
      const m = /^(movie|tv):(\d+)$/.exec(ref);
      if (m) {
        kind = m[1] === "movie" ? "movie" : "series";
        id = Number(m[2]);
      }
      if (kind === "tv") kind = "series";
      if ((kind === "movie" || kind === "series") && id) out.push({ kind, id: Number(id), p: progressOf(e) });
    }
    return out;
  } catch (e) {
    return [];
  }
}

// Progreso de 0 a 1. Sin datos de progreso, cuenta como visto (1).
function progressOf(e) {
  if (!e) return 1;
  if (e.watched === true || e.completed === true || e.finished === true) return 1;
  if (typeof e.progress === "number") return e.progress > 1 ? e.progress / 100 : e.progress;
  const pos = Number(e.position || e.positionMs || e.time || 0);
  const dur = Number(e.duration || e.durationMs || 0);
  if (dur > 0) return Math.min(1, pos / dur);
  return 1;
}

// Mapa "movie:123" / "series:456" -> "done" | "partial"
async function statusMap() {
  const map = new Map();
  const hist = await readHistory();
  for (const h of hist) {
    const k = h.kind + ":" + h.id;
    const st = h.p >= 0.9 ? "done" : "partial";
    if (map.get(k) !== "done") map.set(k, st);
  }
  return map;
}

function mark(it, st) {
  const s = st.get((it.kind === "movie" ? "movie" : "series") + ":" + (it.ids && it.ids.tmdb));
  if (!s) return it;
  const tag = s === "done" ? t("Visto", "Watched") + " · " : "▶ ";
  return Object.assign({}, it, { title: tag + it.title });
}

async function paraTi() {
  const hist = await readHistory();
  const seen = new Set(hist.map((h) => h.kind + ":" + h.id));
  // los 6 más recientes (asumiendo que el historial viene del más nuevo al más viejo)
  const seeds = [];
  const seedKeys = new Set();
  for (const h of hist) {
    const k = h.kind + ":" + h.id;
    if (seedKeys.has(k)) continue;
    seedKeys.add(k);
    seeds.push(h);
    if (seeds.length >= 6) break;
  }
  let lists = [];
  if (seeds.length) {
    const res = await Promise.all(
      seeds.map((s) =>
        raw(s.kind, "/" + (s.kind === "movie" ? "movie" : "tv") + "/" + s.id + "/recommendations", {}).catch(
          () => []
        )
      )
    );
    // mezcla una de cada lista para variar
    const max = Math.max(...res.map((l) => l.length));
    for (let i = 0; i < max; i++) for (const l of res) if (l[i]) lists.push(l[i]);
  }
  lists = lists.filter((x) => !seen.has(x.kind + ":" + x.r.id));
  if (lists.length < 10) {
    // sin historial o pocas recomendaciones: completa con lo popular
    const [m, s] = await Promise.all([trending("movie"), trending("series")]);
    const fill = [];
    for (let i = 0; i < Math.max(m.length, s.length); i++) {
      if (m[i]) fill.push(m[i]);
      if (s[i]) fill.push(s[i]);
    }
    lists = lists.concat(fill.filter((x) => !seen.has(x.kind + ":" + x.r.id)));
  }
  return items(lists, 20);
}

function rowDefs() {
  const platform = (key, name) => [
    {
      id: key + "-pelis",
      title: t(name + ": Películas", name + ": Movies"),
      genre: "peliculas",
      load: async () => items(await premieres("movie", PROV[key]), 20),
    },
    {
      id: key + "-series",
      title: t(name + ": Series", name + ": Series"),
      genre: "series",
      load: async () => items(await premieres("series", PROV[key]), 20),
    },
  ];
  return {
    parati: [
      {
        id: "para-ti",
        title: t("Para Ti", "For You"),
        load: async () => await paraTi(),
      },
    ],
    estrenos: [
      {
        id: "estrenos-pelis",
        title: t("Estrenos: Películas", "New: Movies"),
        genre: "peliculas",
        load: async () => items(await premieres("movie", PROV.todas), 20),
      },
      {
        id: "estrenos-series",
        title: t("Estrenos: Series", "New: Series"),
        genre: "series",
        load: async () => items(await premieres("series", PROV.todas), 20),
      },
    ],
    vistas: [
      {
        id: "top-peliculas",
        title: t("Top 20: Películas", "Top 20: Movies"),
        genre: "peliculas",
        load: async () => items(await trending("movie"), 20),
      },
      {
        id: "top-series",
        title: t("Top 20: Series", "Top 20: Series"),
        genre: "series",
        load: async () => items(await trending("series"), 20),
      },
    ],
    netflix: platform("netflix", "Netflix"),
    prime: platform("prime", "Prime Video"),
    kdramas: [
      {
        id: "top-kdramas",
        title: t("Top 20: K-Dramas", "Top 20: K-Dramas"),
        genre: "doramas",
        load: async () => items(await kdramas(), 20),
      },
    ],
    turcas: [
      {
        id: "top-turcas",
        title: t("Top 20: Series Turcas", "Top 20: Turkish Series"),
        genre: "series",
        load: async () => items(await turcas(), 20),
      },
    ],
  };
}

async function buildRows(defs) {
  const errs = [];
  const st = await statusMap();
  const rows = await Promise.all(
    defs.map(async (d) => {
      try {
        const list = (await d.load()).map((it) => mark(it, st));
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

// TEMPORAL: muestra qué ofrece Kino y cuántos títulos hay en el historial
async function diagRow() {
  let keys = "?";
  try {
    const s = new Set(Object.keys(kino));
    Object.getOwnPropertyNames(kino).forEach((k) => s.add(k));
    keys = Array.from(s).join(", ");
  } catch (e) {}
  const h = await readHistory();
  return {
    id: "diag",
    title: ("DIAG kino: " + keys + " | historial: " + h.length).slice(0, 190),
    items: [{ id: "d0", ref: "movie:0", title: "Diagnóstico temporal", kind: "movie" }],
  };
}

export async function home() {
  const all = rowDefs();
  const order = ["parati", "vistas", "estrenos", "netflix", "prime", "kdramas", "turcas"];
  const defs = [];
  for (const k of order) defs.push(...all[k]);
  const rows = await buildRows(defs);
  return [await diagRow(), ...rows];
}

export async function section({ tab }) {
  const all = rowDefs();
  const tabs = [
    { id: "parati", label: t("Para Ti", "For You") },
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
