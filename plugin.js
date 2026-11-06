const IMG = "https://image.tmdb.org/t/p/";
const LANG = "es-MX";
const REGION = "MX";
const TTL_MS = 10 * 60 * 1000;
const PROV = {
  netflix: "8",
  prime: "119|9",
  hbo: "1899|384",
  disney: "337",
  apple: "350",
  paramount: "531",
  mgm: "34",
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

// Varias paginas de TMDB (20 por pagina). Con n <= 20 es una sola llamada, igual que antes.
async function rawPages(kind, path, params, n) {
  const count = Math.max(1, Math.ceil((n || 20) / 20));
  if (count === 1) return raw(kind, path, params);
  const parts = await Promise.all(
    Array.from({ length: count }, (_, i) => raw(kind, path, Object.assign({}, params, { page: i + 1 })))
  );
  return [].concat(...parts);
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

function trending(kind, n) {
  return rawPages(kind, "/trending/" + (kind === "movie" ? "movie" : "tv") + "/week", {}, n);
}

// Más vistas: tendencia general (50%) + populares de Paramount+ (25%) y MGM+ (25%)
async function vistasMix(kind, lim) {
  const [tr, pa, mg] = await Promise.all([
    trending(kind, lim),
    popular(kind, PROV.paramount, 20).catch(() => []),
    popular(kind, PROV.mgm, 20).catch(() => []),
  ]);
  const mixed = [];
  const max = Math.max(tr.length, pa.length, mg.length);
  for (let i = 0; i < max; i++) {
    if (tr[i * 2]) mixed.push(tr[i * 2]);
    if (tr[i * 2 + 1]) mixed.push(tr[i * 2 + 1]);
    if (pa[i]) mixed.push(pa[i]);
    if (mg[i]) mixed.push(mg[i]);
  }
  return items(mixed, lim);
}

function premieres(kind, providers, n) {
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
  return rawPages(kind, "/discover/" + (isMovie ? "movie" : "tv"), params, n);
}

function popular(kind, providers, n) {
  const isMovie = kind === "movie";
  return rawPages(
    kind,
    "/discover/" + (isMovie ? "movie" : "tv"),
    {
      watch_region: REGION,
      with_watch_providers: providers,
      with_watch_monetization_types: "flatrate",
      sort_by: "popularity.desc",
    },
    n
  );
}

// Estrenos de la plataforma; si hay menos de "limit", se rellena con lo popular.
async function premieresFilled(kind, providers, limit) {
  const lim = limit || 20;
  const out = items(await premieres(kind, providers, lim), lim);
  if (out.length >= lim) return out;
  const seen = new Set(out.map((x) => x.id));
  const fill = items(await popular(kind, providers, lim), lim * 2);
  for (const it of fill) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= lim) break;
  }
  return out;
}

// ===== Filtros K-Dramas =====
const KD_IDS_BLOQUEADOS = []; // IDs de TMDB a ocultar, ej. [12345, 67890]
const KD_PALABRAS_BLOQUEADAS = [
  "suicidio", "suicida", "violacion", "abuso sexual", "abuso",
  "acoso sexual", "agresion sexual", "autolesion", "incesto",
  "pedofilia", "tortura", "violencia sexual", "erotic", "sexo explicito",
];

function kdHangul(s) {
  return /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(String(s || ""));
}

// Sin hangul en el titulo y con sinopsis en español
function kdEnEspanol(r) {
  if (!r) return false;
  const title = r.name || r.title || "";
  if (!title || kdHangul(title)) return false;
  const ov = String(r.overview || "").trim();
  if (!ov || kdHangul(ov)) return false;
  return true;
}

function kdSensible(r) {
  if (KD_IDS_BLOQUEADOS.includes(r.id)) return true;
  const texto = norm((r.name || r.title || "") + " " + (r.overview || ""));
  return KD_PALABRAS_BLOQUEADAS.some((p) => texto.includes(norm(p)));
}

function kdFiltrar(list) {
  return list.filter(({ r }) => kdEnEspanol(r) && !kdSensible(r));
}

function kdramaParams(extra) {
  return Object.assign(
    { with_origin_country: "KR", with_original_language: "ko", sort_by: "popularity.desc" },
    extra || {}
  );
}

// K-dramas por grupos: 1) ultimos 90 dias, 2) ultimo año, 3) populares de siempre.
// Dentro de cada grupo se ordena por popularidad.
async function kdramasFilled(limit) {
  const lim = limit || 20;
  const pedir = lim * 3;
  const out = [];
  const seen = new Set();

  const agregar = (lista) => {
    for (const it of items(kdFiltrar(lista), lim * 3)) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
      if (out.length >= lim) return;
    }
  };

  // 1) Estrenos de los ultimos 90 dias
  agregar(
    await rawPages(
      "series",
      "/discover/tv",
      kdramaParams({ "first_air_date.gte": day(-90), "first_air_date.lte": day(0) }),
      pedir
    )
  );
  if (out.length >= lim) return out;

  // 2) Estrenos del ultimo año (antes de los 90 dias)
  agregar(
    await rawPages(
      "series",
      "/discover/tv",
      kdramaParams({ "first_air_date.gte": day(-365), "first_air_date.lte": day(-91) }),
      pedir
    )
  );
  if (out.length >= lim) return out;

  // 3) Relleno: los mas populares de siempre
  agregar(await rawPages("series", "/discover/tv", kdramaParams(), pedir));
  return out;
}

// ===== Viki + iQIYI (coreano, con sinopsis en español latino) =====
// 344 = Rakuten Viki y 581 = iQIYI en TMDB. Además se busca por nombre en la lista
// de TMDB, por si cambian; si esa consulta falla se usan solo estos dos números.
const VIKI_FALLBACK = ["344", "581"];
let vikiProv = null;

async function vikiProviders() {
  if (vikiProv) return vikiProv;
  const ids = new Set(VIKI_FALLBACK);
  try {
    const d = await tmdb("/watch/providers/tv", { watch_region: REGION });
    const list = d && Array.isArray(d.results) ? d.results : [];
    for (const p of list) {
      if (p && /viki|iqiyi/i.test(String(p.provider_name || ""))) ids.add(String(p.provider_id));
    }
  } catch (e) {
    // se queda con los dos números de arriba
  }
  vikiProv = Array.from(ids).join("|");
  return vikiProv;
}

// Lo más popular de siempre (sin filtro de fecha) en Viki e iQIYI, solo coreano,
// sin hangul y con sinopsis en español. Solo lo disponible en México.
async function vikiFilled(kind, limit) {
  const lim = limit || 20;
  const pedir = lim * 3;
  const isMovie = kind === "movie";
  const prov = await vikiProviders();
  const out = [];
  const seen = new Set();
  for (const region of [REGION]) {
    if (out.length >= lim) break;
    let lista = [];
    try {
      lista = await rawPages(
        kind,
        "/discover/" + (isMovie ? "movie" : "tv"),
        {
          watch_region: region,
          with_watch_providers: prov,
          with_original_language: "ko",
          sort_by: "popularity.desc",
        },
        pedir
      );
    } catch (e) {
      lista = [];
    }
    for (const it of items(kdFiltrar(lista), lim * 3)) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
      if (out.length >= lim) break;
    }
  }
  return out;
}

// ===== Series turcas =====
function turcaParams(extra) {
  return Object.assign(
    { with_origin_country: "TR", with_original_language: "tr", sort_by: "popularity.desc" },
    extra || {}
  );
}

// Con titulo y con sinopsis en español (si no hay traduccion, TMDB la deja vacia)
function turEnEspanol(r) {
  if (!r) return false;
  const title = r.name || r.title || "";
  if (!title) return false;
  return String(r.overview || "").trim().length > 0;
}

// Turcas: 1) 60% populares de siempre, 2) 40% estrenos 90 dias, 3) de 91 a 365 dias.
async function turcasFilled(limit) {
  const lim = limit || 20;
  const pedir = lim * 3;
  const metaPopulares = Math.round(lim * 0.6);
  const metaEstrenos = lim; // llega al total: 60% populares + 40% estrenos
  const out = [];
  const seen = new Set();

  const agregar = (lista, meta) => {
    const filtrada = lista.filter(({ r }) => turEnEspanol(r));
    for (const it of items(filtrada, lim * 3)) {
      if (out.length >= meta) return;
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
  };

  const populares = await rawPages("series", "/discover/tv", turcaParams(), pedir);

  // 1) Las mas populares de siempre (60%)
  agregar(populares, metaPopulares);

  // 2) Estrenos de los ultimos 90 dias (40%)
  agregar(
    await rawPages(
      "series",
      "/discover/tv",
      turcaParams({ "first_air_date.gte": day(-90), "first_air_date.lte": day(0) }),
      pedir
    ),
    metaEstrenos
  );

  if (out.length >= lim) return out;

  // 3) Si faltan estrenos: de 91 dias hasta 1 año
  agregar(
    await rawPages(
      "series",
      "/discover/tv",
      turcaParams({ "first_air_date.gte": day(-365), "first_air_date.lte": day(-91) }),
      pedir
    ),
    lim
  );

  // Si aun falta, se completa con mas populares
  agregar(populares, lim);
  return out;
}

// Para Ti a partir de lo que la persona ya vio. Si no hay historial
// (o kino.library no existe) devuelve una lista vacia.
async function fromHistory(limit) {
  await null;
  if (typeof kino.library !== "object") return [];
  let seen = [];
  try {
    seen = (await kino.library.watched({ limit: 30 })) || [];
  } catch (e) {
    return [];
  }
  const valid = seen.filter((e) => e && e.ids && e.ids.tmdb);
  if (!valid.length) return [];
  const watchedKeys = new Set(valid.map((e) => e.kind + ":" + e.ids.tmdb));
  const base = valid.slice(0, 6);
  const lists = await Promise.all(
    base.map(async (e) => {
      const kind = e.kind === "movie" ? "movie" : "series";
      try {
        return await raw(kind, "/" + (kind === "movie" ? "movie" : "tv") + "/" + e.ids.tmdb + "/recommendations", {});
      } catch (err) {
        return [];
      }
    })
  );
  const mixed = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const l of lists) {
      if (l[i] && !watchedKeys.has(l[i].kind + ":" + l[i].r.id)) mixed.push(l[i]);
    }
  }
  return items(mixed, limit || 20);
}

// Respaldo de Para Ti: lo mas popular de la semana y lo mejor calificado,
// mezclando peliculas y series.
async function fallbackParaTi(limit) {
  const lists = await Promise.all([
    raw("movie", "/trending/movie/week", {}).catch(() => []),
    raw("series", "/trending/tv/week", {}).catch(() => []),
    raw("movie", "/movie/top_rated", {}).catch(() => []),
    raw("series", "/tv/top_rated", {}).catch(() => []),
  ]);
  const mixed = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const l of lists) {
      if (l[i]) mixed.push(l[i]);
    }
  }
  return items(mixed, limit || 20);
}

async function paraTi(limit) {
  await null;
  const lim = limit || 20;
  let hist = [];
  try {
    hist = await fromHistory(lim);
  } catch (e) {
    hist = [];
  }
  // Con buen historial, solo recomendaciones personales.
  if (hist.length >= 10) return hist;
  // Sin historial (o poco): se completa con el respaldo, sin repetir.
  const fb = await fallbackParaTi(lim);
  const seen = new Set(hist.map((x) => x.id));
  const out = hist.slice();
  for (const it of fb) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= lim) break;
  }
  return out;
}

// limit = cuantos titulos por fila: 20 en Inicio (por defecto), 35 en la biblioteca.
function rowDefs(limit) {
  const lim = limit || 20;
  const platform = (key, name) => [
    {
      id: key + "-pelis",
      title: t(name + ": Películas", name + ": Movies"),
      genre: "peliculas",
      load: async () => premieresFilled("movie", PROV[key], lim),
    },
    {
      id: key + "-series",
      title: t(name + ": Series", name + ": Series"),
      genre: "series",
      load: async () => premieresFilled("series", PROV[key], lim),
    },
  ];
  return {
    parati: [
      {
        id: "para-ti",
        title: t("Para Ti", "For You"),
        load: async () => paraTi(lim),
      },
    ],
    vistas: [
      {
        id: "vistas-pelis",
        title: t("Más vistas: Películas", "Most watched: Movies"),
        genre: "peliculas",
        load: async () => vistasMix("movie", lim),
      },
      {
        id: "vistas-series",
        title: t("Más vistas: Series", "Most watched: Series"),
        genre: "series",
        load: async () => vistasMix("series", lim),
      },
    ],
    netflix: platform("netflix", "Netflix"),
    prime: platform("prime", "Prime Video"),
    hbo: platform("hbo", "HBO"),
    disney: platform("disney", "Disney"),
    apple: platform("apple", "Apple TV"),
    kdramas: [
      {
        id: "top-kdramas",
        title: t("K-Dramas", "K-Dramas"),
        genre: "doramas",
        load: async () => kdramasFilled(lim),
      },
    ],
    viki: [
      {
        id: "viki-pelis",
        title: t("Viki: Películas", "Viki: Movies"),
        genre: "peliculas",
        load: async () => vikiFilled("movie", lim),
      },
      {
        id: "viki-series",
        title: t("Viki: Series", "Viki: Series"),
        genre: "doramas",
        load: async () => vikiFilled("series", lim),
      },
    ],
    turcas: [
      {
        id: "top-turcas",
        title: t("Series Turcas", "Turkish Series"),
        genre: "series",
        load: async () => turcasFilled(lim),
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
  if (typeof kino.library !== "object") return null;
  const map = new Map();
  try {
    for (const k of ["movie", "series"]) {
      const list = await kino.library.watched({ limit: 100, kind: k });
      for (const e of list || []) {
        if (!e) continue;
        if (e.ids && e.ids.tmdb) map.set(e.kind + ":" + e.ids.tmdb, e);
        if (e.title) map.set(e.kind + ":t:" + norm(e.title), e);
      }
    }
  } catch (e) {
    return null;
  }
  return map;
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
      it.title = (st.done ? t("Visto", "Watched") + " · " : "▶ ") + it.title;
      it.overview = (label + (it.overview ? "\n\n" + it.overview : "")).slice(0, 2000);
      return it;
    })
  );
}

async function buildRows(defs) {
  const errs = [];
  const watched = await loadWatched();
  const rows = await Promise.all(
    defs.map(async (d) => {
      try {
        let list = await d.load();
        list = await mark(list, watched);
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
  const order = ["parati", "vistas", "netflix", "prime", "hbo", "disney", "apple", "kdramas", "viki", "turcas"];
  const defs = [];
  for (const k of order) defs.push(...all[k]);
  const rows = await buildRows(defs);
  // En el home se quita "genre" para que las filas de películas no se
  // redirijan solo a la biblioteca, y se prefija el id para evitar choques.
  return rows.map(({ genre, ...row }) => ({ ...row, id: "home-" + row.id }));
}

export async function section({ tab }) {
  // En la biblioteca: 35 titulos por fila y sin las pestañas de Para Ti, Más vistas, K-dramas ni turcas.
  const tabs = [
    { id: "netflix", label: "Netflix" },
    { id: "prime", label: "Prime Video" },
    { id: "hbo", label: "HBO" },
    { id: "disney", label: "Disney" },
    { id: "apple", label: "Apple TV" },
    { id: "viki", label: "Viki" },
  ];
  const chosen = tabs.some((x) => x.id === tab) ? tab : "netflix";
  const all = rowDefs(35);
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
