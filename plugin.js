// DIAGNÓSTICO 3 de Top Streaming 2.0 (versión 0.1.16).
// Muestra, como nombre de tres títulos, qué pasa con la API de TMDB y con sus imágenes.

function card(id, title) {
  return {
    id,
    ref: JSON.stringify({ kind: "movie", id }),
    title: String(title).slice(0, 150),
    kind: "movie",
    genres: ["peliculas"],
  };
}

async function waitMs(total) {
  let left = total;
  while (left > 0) {
    const step = Math.min(5000, left);
    await kino.sleep(step);
    left -= step;
  }
  return "timeout";
}

async function testApi() {
  try {
    if (typeof kino.tmdb !== "function") return "kino.tmdb NO existe";
    const t0 = Date.now();
    const r = await Promise.race([kino.tmdb("/configuration", {}), waitMs(18000)]);
    if (r === "timeout") return "API de TMDB: sin respuesta en 18 s";
    return "API de TMDB OK en " + (Date.now() - t0) + " ms";
  } catch (e) {
    return "API de TMDB error: " + ((e && e.code) || "?") + " " + String((e && e.message) || "").slice(0, 50);
  }
}

async function testImages() {
  try {
    const t0 = Date.now();
    const r = await Promise.race([kino.fetch("https://image.tmdb.org/t/p/w92/", { timeoutMs: 8000 }), waitMs(9000)]);
    if (r === "timeout") return "Imágenes de TMDB: sin respuesta en 9 s";
    return "Imágenes de TMDB responden (código " + ((r && r.status) || "?") + ") en " + (Date.now() - t0) + " ms";
  } catch (e) {
    return "Imágenes de TMDB error: " + ((e && e.code) || "?") + " " + String((e && e.message) || "").slice(0, 50);
  }
}

export async function home() {
  await null;
  const [api, img] = await Promise.all([testApi(), testImages()]);
  return [
    {
      id: "diag",
      title: "Diagnóstico",
      genre: "peliculas",
      items: [card("diag-1", "1) Kino " + kino.appVersion + " · api " + kino.apiVersion), card("diag-2", "2) " + api), card("diag-3", "3) " + img)],
    },
  ];
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
