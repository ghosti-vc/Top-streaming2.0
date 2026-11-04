async function kdramasFilled(limit) {
  const lim = limit || 20;
  const pedir = lim * 5;
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