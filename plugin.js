async function test(id, path, params) {
  await null;
  let msg;
  let poster;
  try {
    const d = await kino.tmdb(path, params);
    const tipo = Array.isArray(d) ? "array" : typeof d;
    const claves = d && typeof d === "object" ? Object.keys(d).slice(0, 5).join(",") : "";
    const lista = Array.isArray(d) ? d : d && Array.isArray(d.results) ? d.results : null;
    msg = "OK " + tipo + " [" + claves + "] n=" + (lista ? lista.length : "?");
    if (!lista) msg += " " + JSON.stringify(d).slice(0, 80);
    if (lista && lista[0] && lista[0].poster_path) {
      poster = "https://image.tmdb.org/t/p/w500" + lista[0].poster_path;
    }
  } catch (e) {
    msg = "ERROR " + (e && (e.code || e.message) ? (e.code || "") + " " + (e.message || "") : String(e));
  }
  const item = { id: "i" + id, ref: "movie:" + id, title: "Prueba " + id, kind: "movie" };
  if (poster) item.poster = poster;
  return { id: "r" + id, title: (id + ") " + path + " -> " + msg).slice(0, 190), items: [item] };
}

async function probe() {
  await null;
  const head = {
    id: "r0",
    title: "0) kino.tmdb = " + typeof kino.tmdb + " | version 0.1.5",
    items: [{ id: "i0", ref: "movie:100", title: "Prueba 0", kind: "movie" }],
  };
  if (typeof kino.tmdb !== "function") return [head];
  const rows = await Promise.all([
    test("1", "/trending/movie/day", { language: "es-MX" }),
    test("2", "trending/movie/day", { language: "es-MX" }),
    test("3", "/trending/movie/day"),
  ]);
  return [head].concat(rows);
}

export async function home() {
  return probe();
}

export async function section({ tab }) {
  const tabs = [{ id: "estrenos", label: "Estrenos" }];
  return { tabs, tab: "estrenos", rows: await probe() };
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