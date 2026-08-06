const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const rankedQueue = require("../lib/rankedQueue");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokedex-ranked-chat-"));
const queueFile = path.join(dir, "rankedQueue.json");
const readJsonSafe = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};
const profile = {
  display: "Tester",
  party: { slots: [
    { caughtAt: 1, displayName: "Leadmon" },
    null,
    { caughtAt: 2, displayName: "Zweitmon" },
    { caughtAt: 3, displayName: "Drittmon" },
    { caughtAt: 4, displayName: "Reserve" },
  ] },
};

rankedQueue.resetCommandCooldownsForTests();
let result = rankedQueue.toggleFromChat({ filePath:queueFile, readJsonSafe, profile, userId:"1", userName:"Tester", rawInput:"!ranked", now:100000 });
assert.equal(result.action, "join");
assert.deepEqual(result.team.map((mon) => mon.caughtAt), [1, 2, 3]);
assert.equal(result.message, "Tester betritt die Ranked-Queue.");
assert.doesNotMatch(result.message, /Leadmon|Zweitmon|Drittmon/);

result = rankedQueue.toggleFromChat({ filePath:queueFile, readJsonSafe, profile, userId:"1", userName:"Tester", rawInput:"!ranked", now:100001 });
assert.equal(result.reason, "cooldown");
assert.equal(result.silent, true);

result = rankedQueue.toggleFromChat({ filePath:queueFile, readJsonSafe, profile, userId:"1", userName:"Tester", rawInput:"!ranked stop", now:111000 });
assert.equal(result.action, "leave");
assert.equal(rankedQueue.publicEntry(rankedQueue.readQueue(queueFile, readJsonSafe), "1").queued, false);

// Some bot paths pass only the command name or only its argument. A plain
// !ranked must remain a toggle regardless of that transport detail.
rankedQueue.resetCommandCooldownsForTests();
result = rankedQueue.toggleFromChat({ filePath:queueFile, readJsonSafe, profile, userId:"1", userName:"Tester", rawInput:"ranked", now:122000 });
assert.equal(result.action, "join");

rankedQueue.resetCommandCooldownsForTests();
result = rankedQueue.toggleFromChat({ filePath:queueFile, readJsonSafe, profile, userId:"1", userName:"Tester", rawInput:"", now:133000 });
assert.equal(result.action, "leave");

rankedQueue.resetCommandCooldownsForTests();
result = rankedQueue.toggleFromChat({ filePath:queueFile, readJsonSafe, profile, userId:"1", userName:"Tester", rawInput:"ranked stop", now:144000 });
assert.equal(result.action, "none");

rankedQueue.resetCommandCooldownsForTests();
result = rankedQueue.toggleFromChat({ filePath:queueFile, readJsonSafe, profile:{ party:{ slots:[{caughtAt:1},{caughtAt:2}] } }, userId:"2", userName:"Klein", rawInput:"!ranked", now:200000 });
assert.equal(result.reason, "not_enough_team_pokemon");

fs.rmSync(dir, { recursive:true, force:true });
console.log("Ranked-Chatbefehl: alle Tests erfolgreich.");
