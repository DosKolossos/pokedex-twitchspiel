const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const requiredFiles = [
  "server/bot.js",
  "server/game-adapter.js",
  "overlay-server.js",
  "overlay-server-v8.js",
  "lib/rankedQueue.js",
  "ecosystem.config.cjs",
  "data/pokedex.json",
  "data/profiles.json",
  "data/spawn.json",
  "data/raidState.json",
  "data/rankedQueue.json",
  "overlay/index.html",
];
let failed = false;
for (const relative of requiredFiles) {
  const exists = fs.existsSync(path.join(root, relative));
  console.log(`${exists ? "OK" : "FEHLT"} ${relative}`);
  if (!exists) failed = true;
}
if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error(`FEHLER Node ${process.versions.node}; benötigt wird Node >=22`);
  failed = true;
} else {
  console.log(`OK Node ${process.versions.node}`);
}
process.exit(failed ? 1 : 0);
