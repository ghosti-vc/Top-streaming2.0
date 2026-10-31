// DIAGNÓSTICO 2 de Top Streaming 2.0 (versión 0.1.15).
// El resultado aparece como NOMBRE de dos títulos en la categoría «Películas».

function card(id, title) {
  return {
    id,
    ref: JSON.stringify({ kind: "movie", id }),
    title: String(title).slice(0, 150),
    kind: "movie",
    genres: ["peliculas"],
  };
}

export async function home() {
  await null;
  const first = card("diag-1", "1) Plugin OK · Kino " + kino.appVersion + " · api " + kino.apiVersion);

  let status;
  try {
    if (typeof kino.tmdb !== "function") {
      status = "2) kino.tmdb NO existe: Kino es muy viejo";
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
    status = "2) TMDB error: " + ((e && e.code) || "?") + " " + String((e && e.message) || "").slice(0, 60);
  }

  return [{ id: "diag", title: "Diagnóstico", genre: "peliculas", items: [first, card("diag-2", status)] }];
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
