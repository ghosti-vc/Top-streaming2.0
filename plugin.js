async function probe() {
  await null;
  const out = [
    { id: "t0", ref: "movie:1", title: "PRUEBA 0.1.4 - el plugin corre", kind: "movie" },
    { id: "t1", ref: "movie:2", title: "kino.tmdb = " + typeof kino.tmdb, kind: "movie" },
  ];
  if (typeof kino.tmdb === "function") {
    try {
      const d = await kino.tmdb("/trending/movie/day", { language: "es-MX" });
      const n = d && Array.isArray(d.results) ? d.results.length : -1;
      out.push({ id: "t2", ref: "movie:3", title: "TMDB ok, resultados: " + n, kind: "movie" });
      if (n > 0) {
        const r = d.results[0];
        out.push({
          id: "m" + r.id,
          ref: "movie:" + r.id,
          title: String(r.title || "sin titulo"),
          kind: "movie",
          poster: r.poster_path ? "https://image.tmdb.org/t/p/w500" + r.poster_path : undefined,
        });
      }
    } catch (e) {
      out.push({
        id: "t3",
        ref: "movie:4",
        title: ("ERROR " + (e && (e.code || e.message) ? (e.code || "") + " " + (e.message || "") : String(e))).slice(0, 190),
        kind: "movie",
      });
    }
  }
  return [{ id: "diag", title: "Diagnóstico", items: out }];
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