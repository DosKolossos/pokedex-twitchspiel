const NATURES = [
  ["hardy","Robust","Hardy",null,null],["lonely","Solo","Lonely","attack","defense"],
  ["brave","Mutig","Brave","attack","speed"],["adamant","Hart","Adamant","attack","specialAttack"],
  ["naughty","Frech","Naughty","attack","specialDefense"],["bold","Kühn","Bold","defense","attack"],
  ["docile","Sanft","Docile",null,null],["relaxed","Locker","Relaxed","defense","speed"],
  ["impish","Pfiffig","Impish","defense","specialAttack"],["lax","Lasch","Lax","defense","specialDefense"],
  ["timid","Scheu","Timid","speed","attack"],["hasty","Hastig","Hasty","speed","defense"],
  ["serious","Ernst","Serious",null,null],["jolly","Froh","Jolly","speed","specialAttack"],
  ["naive","Naiv","Naive","speed","specialDefense"],["modest","Mäßig","Modest","specialAttack","attack"],
  ["mild","Mild","Mild","specialAttack","defense"],["quiet","Ruhig","Quiet","specialAttack","speed"],
  ["bashful","Zaghaft","Bashful",null,null],["rash","Hitzig","Rash","specialAttack","specialDefense"],
  ["calm","Still","Calm","specialDefense","attack"],["gentle","Zart","Gentle","specialDefense","defense"],
  ["sassy","Forsch","Sassy","specialDefense","speed"],["careful","Sacht","Careful","specialDefense","specialAttack"],
  ["quirky","Kauzig","Quirky",null,null],
].map(([id,de,en,up,down]) => ({ id, de, en, up, down }));

const fold = (value) => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
const ALIASES = new Map();
for (const nature of NATURES) {
  for (const value of [nature.id, nature.de, nature.en]) ALIASES.set(fold(value), nature);
}
// Häufige Tastatureingabe für „Mäßig“ ohne ß.
ALIASES.set("massig", NATURES.find((nature) => nature.id === "modest"));

function parseNature(input) { return ALIASES.get(fold(input)) || null; }
function randomNature(random = Math.random) { return NATURES[Math.floor(random() * NATURES.length)] || NATURES[0]; }
function natureMultiplier(natureInput, stat) {
  const nature = typeof natureInput === "string" ? parseNature(natureInput) : natureInput;
  if (!nature) return 1;
  if (nature.up === stat) return 1.1;
  if (nature.down === stat) return 0.9;
  return 1;
}
function calculateStats(baseStats, level, natureInput) {
  const lv = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
  const get = (key) => Math.max(1, Number(baseStats?.[key]) || 1);
  const normal = (key) => Math.floor((Math.floor(((2 * get(key) + 31) * lv) / 100) + 5) * natureMultiplier(natureInput, key));
  return {
    hp: Math.floor(((2 * get("hp") + 31) * lv) / 100) + lv + 10,
    attack: normal("attack"), defense: normal("defense"),
    specialAttack: normal("specialAttack"), specialDefense: normal("specialDefense"), speed: normal("speed"),
  };
}

function changeActiveNature({ userId, userName, input, store, paths }) {
  const nature = parseNature(input);
  if (!nature) return { ok:false, reason:"invalid_nature" };
  const profiles = store.readJson(paths.PROFILES_JSON, { users:{} }) || { users:{} };
  const pokedex = store.readJson(paths.POKEDEX_JSON, { users:{} }) || { users:{} };
  const profile = profiles.users?.[String(userId)];
  const activeSlot = Number(profile?.party?.activeSlot || 0);
  const active = profile?.party?.slots?.[activeSlot] || profile?.party?.slots?.find(Boolean);
  if (!active?.caughtAt) return { ok:false, reason:"no_active_pokemon" };
  const mon = pokedex.users?.[String(userId)]?.caught?.find((entry) => Number(entry?.caughtAt) === Number(active.caughtAt));
  if (!mon) return { ok:false, reason:"pokemon_not_found" };
  const previous = parseNature(mon.nature) || null;
  mon.nature = nature.id;
  active.nature = nature.id;
  profile.display = userName || profile.display;
  profile.updatedAt = Date.now();
  store.writeJson(paths.POKEDEX_JSON, pokedex);
  store.writeJson(paths.PROFILES_JSON, profiles);
  return { ok:true, nature, previous, pokemon:mon.displayName || mon.name || "Pokémon" };
}

module.exports = { NATURES, parseNature, randomNature, natureMultiplier, calculateStats, changeActiveNature };
