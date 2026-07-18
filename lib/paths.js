const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = process.env.POKEDEX_DATA_DIR
  ? path.resolve(process.env.POKEDEX_DATA_DIR)
  : path.join(ROOT, "data");
const OUT_DIR = path.join(DATA_DIR, "out");

module.exports = {
  ROOT,
  DATA_DIR,
  OUT_DIR,

  SPAWN_JSON: path.join(DATA_DIR, "spawn.json"),
  POKEDEX_JSON: path.join(DATA_DIR, "pokedex.json"),
  PROFILES_JSON: path.join(DATA_DIR, "profiles.json"),
  TRADES_JSON: path.join(DATA_DIR, "trades.json"),
  DEXMAP_JSON: path.join(DATA_DIR, "dexmap.json"),
  EVOLUTIONS_JSON: path.join(DATA_DIR, "evolutions.json"),
  RAID_STATE_JSON: path.join(DATA_DIR, "raidState.json"),
  RAID_BOSSES_JSON: path.join(DATA_DIR, "raidBosses.json"),

  RAID_MESSAGE_TXT: path.join(DATA_DIR, "raidMessage.txt"),
  SPAWN_MESSAGE_TXT: path.join(DATA_DIR, "spawnMessage.txt"),
  CATCH_MESSAGE_TXT: path.join(DATA_DIR, "catchMessage.txt"),
  RESOLVE_MESSAGE_TXT: path.join(DATA_DIR, "resolveMessage.txt"),

  itemMessageFile: (userId) => path.join(OUT_DIR, `itemMessage_${userId}.txt`),
  tradeMessageFile: (userId) => path.join(OUT_DIR, `tradeMessage_${userId}.txt`),
  dexMessageFile: (userId) => path.join(OUT_DIR, `dexMessage_${userId}.txt`),
  partyMessageFile: (userId) => path.join(OUT_DIR, `partyMessage_${userId}.txt`),
  evoMessageFile: (userId) => path.join(OUT_DIR, `evoMessage_${userId}.txt`),
};
