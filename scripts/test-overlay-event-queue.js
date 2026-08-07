const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const queue = require("../lib/overlayEventQueue");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokedex-overlay-queue-"));
const file = path.join(dir, "queue.json");
const readJson = (target, fallback) => {
  try { return JSON.parse(fs.readFileSync(target, "utf8")); } catch { return fallback; }
};

queue.enqueue(file, readJson, { id:"battle-1", type:"ranked", battleId:"1" });
queue.enqueue(file, readJson, { id:"spawn-1", type:"spawn", payload:{ pokemon:{ name:"Schiggy" } } });
queue.enqueue(file, readJson, { id:"raid-1", type:"raid" });

assert.strictEqual(queue.claimHead(file, readJson, "spawn"), null, "Spawn darf einen Kampf nicht überholen");
assert.strictEqual(queue.claimHead(file, readJson, "ranked").id, "battle-1");
assert.strictEqual(queue.hasOpenType(file, readJson, "spawn"), true, "Wartender Spawn muss !spawn sperren");
assert.strictEqual(queue.enqueue(file, readJson, { id:"spawn-1", type:"spawn" }).ok, false, "Doppelter Spawnjob wird abgelehnt");
queue.complete(file, readJson, "battle-1");
assert.strictEqual(queue.claimHead(file, readJson, "spawn").id, "spawn-1");
queue.complete(file, readJson, "spawn-1");

const activeSpawnEvent = { id:"spawn-grace", type:"spawn", status:"active" };
assert.strictEqual(
  queue.spawnNeedsStart(activeSpawnEvent, { active:true, pokemon:{ name:"Traumato" }, endsAt:Date.now() - 1 }),
  false,
  "Ein Spawn darf im Resolve-Puffer nach endsAt nicht erneut gestartet werden"
);
assert.strictEqual(
  queue.spawnNeedsStart(activeSpawnEvent, { active:false, pokemon:null, endsAt:0 }),
  true,
  "Ein erstmals aktivierter Spawn muss gestartet werden"
);
assert.strictEqual(queue.claimHead(file, readJson, "raid").id, "raid-1");
queue.complete(file, readJson, "raid-1");
assert.strictEqual(queue.head(file, readJson), null);

fs.rmSync(dir, { recursive:true, force:true });
console.log("✓ Overlay-Queue arbeitet strikt FIFO und sperrt wartende Spawns");
