const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const queue = require("../lib/rankedQueue");

const profile = { party:{ slots:[
  { caughtAt:11, name:"A", level:10 },
  { caughtAt:22, name:"B", level:20 },
  { caughtAt:33, name:"C", level:30 },
  { caughtAt:44, name:"D", level:40 },
] } };
const snapshot = queue.snapshotTeam(profile, [11,22,33]);
assert.equal(snapshot.length, 3);
profile.party.slots[0].level = 99;
assert.equal(snapshot[0].level, 10, "Snapshot darf spätere Änderungen nicht übernehmen");
const state = { entries:{ user:{ team:snapshot, joinedAt:123 } } };
assert.equal(queue.lockedCaughtAt(state,"user",22),true);
assert.equal(queue.lockedCaughtAt(state,"user",44),false);
assert.deepEqual(queue.publicEntry(state,"user"),{queued:true,joinedAt:123,team:snapshot});
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokedex-ranked-clear-"));
const queueFile = path.join(tempDir, "rankedQueue.json");
queue.writeQueue(queueFile, { entries:{ user:{ team:snapshot, joinedAt:123 }, other:{ team:[], joinedAt:456 } } });
assert.equal(queue.clearQueue(queueFile, (file, fallback) => JSON.parse(fs.readFileSync(file, "utf8")) || fallback), 2);
assert.deepEqual(queue.readQueue(queueFile, (file) => JSON.parse(fs.readFileSync(file, "utf8"))).entries, {});
console.log("Ranked-Queue, Snapshot und Pokémon-Sperre erfolgreich getestet.");
