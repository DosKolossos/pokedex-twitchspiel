const fs = require("fs");

function emptyQueue() {
  return { version: 1, entries: {} };
}

function normalizeQueue(value) {
  return value && typeof value === "object"
    ? { version: 1, entries: value.entries && typeof value.entries === "object" ? value.entries : {} }
    : emptyQueue();
}

function readQueue(filePath, readJsonSafe) {
  return normalizeQueue(readJsonSafe(filePath, emptyQueue()));
}

function writeQueue(filePath, queue) {
  fs.writeFileSync(filePath, JSON.stringify(normalizeQueue(queue), null, 2));
}

function publicEntry(queue, userId) {
  const entry = queue.entries?.[String(userId)];
  if (!entry) return { queued: false, joinedAt: null, team: [] };
  return { queued: true, joinedAt: Number(entry.joinedAt || 0), team: entry.team || [] };
}

function lockedCaughtAt(queue, userId, caughtAt) {
  const target = Number(caughtAt || 0);
  return (queue.entries?.[String(userId)]?.team || []).some((mon) => Number(mon.caughtAt) === target);
}

function snapshotTeam(profile, caughtAts) {
  const selected = new Set(caughtAts.map(Number));
  return (profile.party?.slots || [])
    .filter((mon) => mon && selected.has(Number(mon.caughtAt)))
    .map((mon) => JSON.parse(JSON.stringify(mon)));
}

module.exports = { readQueue, writeQueue, publicEntry, lockedCaughtAt, snapshotTeam };
