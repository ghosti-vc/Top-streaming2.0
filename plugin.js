// DIAGNÓSTICO de Top Streaming 2.0 (versión 0.1.14).
// No carga catálogo: muestra la versión de Kino y el resultado de UNA consulta a TMDB.

const SAMPLE = {
  id: "m-10378",
  ref: JSON.stringify({ kind: "movie", id: 10378 }),
  title: "Big Buck Bunny",
  kind: "movie",
  genres: ["peliculas"],
  ids: { tmdb: 10378 },
};

function row(id, title) {
  return { id, title: String(title).slice(0, 120), genre: "peliculas", items: [SAMPLE] };
}

export async function home() {
  await null;
  const rows = [
    row("diag-version", "1) El plugin arrancó · Kino " + kino.appVersion + " · api " + kino.apiVersion + " · idioma " + kino.lang),
  ];

  let status;
  try {
    if (typeof kino.tmdb !== "function") {
      status = "2) kino.tmdb NO existe: Kino es muy viejo (hace falta 0.9.53 o más)";
    } else {
      const t0 = Date.now();
      const timeout = (async () => {
        await kino.sleep(5000);
        await kino.sleep(5000);
        return "timeout";
      })();
      const r = await Promise.race([kino.tmdb("/trending/movie/day", { language: "es-MX", page: "1" }), timeout]);
      if (r === "timeout") {
        status = "2) TMDB no respondió en 10 s";
      } else {
        status = "2) TMDB OK: " + ((r && r.results) || []).length + " títulos en " + (Date.now() - t0) + " ms";
      }
    }
  } catch (e) {
    status = "2) TMDB error: " + ((e && e.code) || "?") + " · " + String((e && e.message) || "").slice(0, 70);
  }
  rows.push(row("diag-tmdb", status));
  return rows;
}

export async function episodes(ref) {
  await null;
  throw kino.error("not_found", "diagnóstico");
}

export async function resolve(ref) {
  await null;
  throw kino.error("not_found", "catálogo sin video", {
    userMessage: "Este catálogo no reproduce: busca el título en tus otras fuentes.",
  });
}
