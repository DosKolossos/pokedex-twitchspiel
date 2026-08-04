const fs = require("fs");
const paths = require("../lib/paths");
const store = require("../lib/fileStore");
const { randomNature } = require("../lib/natures");

const pokedex = store.readJson(paths.POKEDEX_JSON, { users:{} }) || { users:{} };
const profiles = store.readJson(paths.PROFILES_JSON, { users:{} }) || { users:{} };
let changed = 0;
for (const [userId, user] of Object.entries(pokedex.users || {})) {
  for (const mon of user.caught || []) {
    if (!mon.nature) { mon.nature = randomNature().id; changed += 1; }
    const slot = profiles.users?.[userId]?.party?.slots?.find((entry) => Number(entry?.caughtAt) === Number(mon.caughtAt));
    if (slot) slot.nature = mon.nature;
  }
}
if (!changed) { console.log("Alle Pokémon besitzen bereits ein Wesen."); process.exit(0); }
const stamp = new Date().toISOString().replace(/[:.]/g,"-");
fs.copyFileSync(paths.POKEDEX_JSON, `${paths.POKEDEX_JSON}.before-natures-${stamp}.bak`);
fs.copyFileSync(paths.PROFILES_JSON, `${paths.PROFILES_JSON}.before-natures-${stamp}.bak`);
store.writeJson(paths.POKEDEX_JSON, pokedex);
store.writeJson(paths.PROFILES_JSON, profiles);
console.log(`${changed} Pokémon erhielten ein zufälliges Wesen. Backups wurden angelegt.`);
