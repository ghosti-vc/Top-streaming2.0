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