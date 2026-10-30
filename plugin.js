const IMG = "https://image.tmdb.org/t/p/";
const LANG = "es-MX";
const REGION = "MX";
const TTL_MS = 30 * 60 * 1000;
const DEBUG = true; // ponlo en false cuando todo funcione
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