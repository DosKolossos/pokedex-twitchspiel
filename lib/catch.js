const { readJson, writeJson, writeText, ensureDirs } = require("./fileStore");
const { SPAWN_JSON, CATCH_MESSAGE_TXT } = require("./paths");
const { log } = require("./logger");

function addParticipant(state, userId, userName) {
  const exists = state.participants.some(p => p.userId === userId);
  if (!exists) state.participants.push({ userId, userName, at: Date.now() });
}

function pickWinner(participants) {
  // TODO: hier steht deine echte Winner-Logik (fair, RNG, weights, etc.)
  // WICHTIG: Nur aus participants wählen – niemals irgendwen anders.
  const idx = Math.floor(Math.random() * participants.length);
  return participants[idx];
}

function handleCatch({ userId, userName }) {
  ensureDirs();

  const state = readJson(SPAWN_JSON, { active: false, pokemon: null, endsAt: 0, participants: [] });
  log("catch", { userId, userName, active: state.active, endsAt: state.endsAt });

  if (!state.active || !state.pokemon) {
    writeText(CATCH_MESSAGE_TXT, `⚠️ Kein aktiver Spawn.`);
    return { ok: false, reason: "no_spawn" };
  }

  const now = Date.now();
  if (now > state.endsAt) {
    // Spawn vorbei: resolve wird woanders gemacht, oder hier:
    writeText(CATCH_MESSAGE_TXT, `⌛ Zu spät! Der Spawn ist vorbei.`);
    return { ok: false, reason: "expired" };
  }

  addParticipant(state, userId, userName);
  writeJson(SPAWN_JSON, state);

  // Die Teilnahme bleibt intern. GameAdapter liest diese Datei nach dem
  // Catch-Befehl; ein leerer Inhalt verhindert die bisherige Chat-Antwort.
  writeText(CATCH_MESSAGE_TXT, "");
  return { ok: true, participants: state.participants.length, silent: true };
}

function resolveCatch() {
  ensureDirs();
  const state = readJson(SPAWN_JSON, { active: false, pokemon: null, endsAt: 0, participants: [] });

  if (!state.active || !state.pokemon) return { ok: false, reason: "no_spawn" };

  const participants = state.participants || [];
  if (!participants.length) {
    // Reset
    writeJson(SPAWN_JSON, { active: false, pokemon: null, endsAt: 0, participants: [] });
    return { ok: false, reason: "no_participants" };
  }

  const winner = pickWinner(participants);

  // Reset spawn
  writeJson(SPAWN_JSON, { active: false, pokemon: null, endsAt: 0, participants: [] });

  return { ok: true, winner, pokemon: state.pokemon };
}

module.exports = { handleCatch, resolveCatch };
