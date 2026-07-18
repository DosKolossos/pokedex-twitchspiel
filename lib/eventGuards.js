// local/lib/eventGuards.js
const { readJson } = require("./fileStore");
const paths = require("./paths");

function hasActiveSpawn() {
  try {
    const s = readJson(paths.SPAWN_JSON, { active: false, endsAt: 0, pokemon: null });
    if (!s) return false;

    // dein Spawn-System nutzt active + endsAt
    const active = !!s.active && Number(s.endsAt || 0) > Date.now();
    return active;
  } catch {
    return false;
  }
}

function getActiveSpawn() {
  try {
    const s = readJson(paths.SPAWN_JSON, { active: false, endsAt: 0, pokemon: null });
    if (!s) return null;
    const active = !!s.active && Number(s.endsAt || 0) > Date.now();
    if (!active) return null;
    return s;
  } catch {
    return null;
  }
}

function hasActiveRaid() {
  try {
    const r = readJson(paths.RAID_STATE_JSON, null);
    return !!r?.current;
  } catch {
    return false;
  }
}

function getActiveRaid() {
  try {
    const r = readJson(paths.RAID_STATE_JSON, null);
    return r?.current || null;
  } catch {
    return null;
  }
}

module.exports = {
  hasActiveSpawn,
  getActiveSpawn,
  hasActiveRaid,
  getActiveRaid,
};