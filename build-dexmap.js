// build-dexmap.js
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "dexmap.json");

async function fetchGermanName(id) {
  const url = `https://pokeapi.co/api/v2/pokemon-species/${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();

  const de = (json.names || []).find(n => n.language?.name === "de")?.name;
  if (!de) throw new Error(`No DE name for id ${id}`);
  return de;
}

async function main() {
  const map = {};

  // Gen 1 = 1..151
  for (let id = 1; id <= 151; id++) {
    const de = await fetchGermanName(id);
    map[String(de).toLowerCase()] = id;
    process.stdout.write(`\rMapping: ${id}/151`);
  }

  fs.writeFileSync(OUT, JSON.stringify(map, null, 2), "utf8");
  console.log(`\n✅ dexmap.json geschrieben: ${OUT}`);
}

main().catch(err => {
  console.error("❌ build-dexmap failed:", err);
  process.exit(1);
});
