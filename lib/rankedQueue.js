const fs = require("fs");

const commandCooldowns = new Map();

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

function toggleFromChat({ filePath, readJsonSafe, profile, userId, userName, rawInput, now = Date.now() }) {
  const id = String(userId || "");
  const display = String(userName || profile?.display || "Trainer");
  const cooldownMs = Math.max(1, Number(process.env.RANKED_COMMAND_COOLDOWN_SECONDS || 10)) * 1000;
  const lastUsedAt = Number(commandCooldowns.get(id) || 0);
  if (now - lastUsedAt < cooldownMs) {
    return { ok: false, reason: "cooldown", silent: true, remainingMs: cooldownMs - (now - lastUsedAt) };
  }
  commandCooldowns.set(id, now);

  if (!id || !profile) {
    return { ok: false, reason: "player_not_found", message: `@${display} Du hast noch kein Pokédex-Profil.` };
  }

  const argument = String(rawInput || "").trim().replace(/^!ranked\b/i, "").trim().toLowerCase();
  if (argument && argument !== "stop") {
    return { ok: false, reason: "invalid_argument", message: `@${display} Nutze !ranked oder !ranked stop.` };
  }

  const queue = readQueue(filePath, readJsonSafe);
  const isQueued = Boolean(queue.entries[id]);
  if (isQueued) {
    delete queue.entries[id];
    writeQueue(filePath, queue);
    return { ok: true, action: "leave", message: `⏹️ @${display} hat die Ranked-Suche beendet.` };
  }
  if (argument === "stop") {
    return { ok: true, action: "none", message: `@${display} Du bist aktuell nicht in der Ranked-Queue.` };
  }

  const team = (profile.party?.slots || []).filter(Boolean).slice(0, 3);
  if (team.length < 3) {
    return { ok: false, reason: "not_enough_team_pokemon", message: `@${display} Du brauchst mindestens drei Pokémon im Team für Ranked.` };
  }

  const snapshot = team.map((mon) => JSON.parse(JSON.stringify(mon)));
  queue.entries[id] = { userId: id, display: profile.display || display, joinedAt: now, team: snapshot };
  writeQueue(filePath, queue);
  return {
    ok: true,
    action: "join",
    team: snapshot,
    message: `${display} betritt die Ranked-Queue.`,
  };
}

function resetCommandCooldownsForTests() {
  commandCooldowns.clear();
}

module.exports = { readQueue, writeQueue, publicEntry, lockedCaughtAt, snapshotTeam, toggleFromChat, resetCommandCooldownsForTests };
