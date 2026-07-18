// local/lib/xp.js
const { readJson, writeJson } = require("./fileStore");
const { PROFILES_JSON } = require("./paths");
const { log, err } = require("./logger");
const party = require("./party");
const evo = require("./evo");


const PARTY_SIZE = 6;

// Tuning
const COOLDOWN_MS = 45_000;     // 45s pro User
const XP_ACTIVE = 1;            // pro Tick
const MAX_LEVEL = 100;
const IGNORE_NAMES = new Set(["squ_eich"]); // bot etc (lowercase)

function now() { return Date.now(); }

function monKey(userId, caughtAt) {
  return `${String(userId)}:${Number(caughtAt) || 0}`;
}

// simple curve: lvl1->2 braucht 60 XP, dann langsam ansteigend
function xpToNext(level) {
  const lv = Math.max(1, Number(level) || 1);
  return 40 + lv * 20;
}

function ensureProfiles() {
  const base = { version: 1, users: {} };
  const p = readJson(PROFILES_JSON, base);
  if (!p || typeof p !== "object") return base;
  if (!p.users || typeof p.users !== "object") p.users = {};
  if (!p.version) p.version = 1;
  return p;
}

function ensureUserProfile(profiles, userId, display) {
  const uid = String(userId || "").trim();
  if (!profiles.users[uid]) {
    profiles.users[uid] = {
      id: uid,
      display: String(display || ""),
      createdAt: now(),
      updatedAt: now(),
      party: { activeSlot: 0, slots: Array.from({ length: PARTY_SIZE }, () => null) },
      progress: {},
      pending: null,
      chat: { lastXpAt: 0 },
    };
  } else {
    const u = profiles.users[uid];
    u.display = String(display || u.display || "");
    u.updatedAt = now();
    u.party ??= { activeSlot: 0, slots: Array.from({ length: PARTY_SIZE }, () => null) };
    u.party.slots ??= Array.from({ length: PARTY_SIZE }, () => null);
    if (u.party.slots.length !== PARTY_SIZE) {
      const old = u.party.slots;
      u.party.slots = Array.from({ length: PARTY_SIZE }, (_, i) => old[i] ?? null);
    }
    u.progress ??= {};
    u.chat ??= { lastXpAt: 0 };
    u.chat.lastXpAt ??= 0;
  }
  return profiles.users[uid];
}

function findActiveSlot(profile) {
  const slots = profile.party?.slots || [];
  let a = Number(profile.party?.activeSlot ?? 0);
  if (a < 0 || a >= slots.length || !slots[a]) {
    const first = slots.findIndex(Boolean);
    if (first !== -1) {
      profile.party.activeSlot = first;
      a = first;
    }
  }
  return slots[a] ? a : -1;
}

function applyXpToMon(profile, userId, slotIndex, xpGain) {
  const slot = profile.party.slots[slotIndex];
  if (!slot?.caughtAt) return { leveledUp: 0, level: 1, xp: 0, atCap: false };

  const key = monKey(userId, slot.caughtAt);
  profile.progress[key] ??= { xp: 0, level: 1, createdAt: now(), updatedAt: now() };

  const prog = profile.progress[key];

  // Legacy-Werte härten (falls ein Mon schon über 100 gespeichert wurde)
  prog.level = Math.max(1, Number(prog.level || 1) || 1);
  prog.xp = Math.max(0, Number(prog.xp || 0) || 0);
  if (prog.level >= MAX_LEVEL) {
    prog.level = MAX_LEVEL;
    prog.xp = 0;
  } else {
    prog.xp += Number(xpGain || 0);
  }

  let ups = 0;
  while (prog.level < MAX_LEVEL && prog.xp >= xpToNext(prog.level)) {
    prog.xp -= xpToNext(prog.level);
    prog.level = Number(prog.level || 1) + 1;
    ups++;
  }

  if (prog.level >= MAX_LEVEL) {
    prog.level = MAX_LEVEL;
    prog.xp = 0; // keine Rest-XP über Cap hinaus
  }

  prog.updatedAt = now();

  // keep slot in sync for UI
  slot.level = prog.level;
  slot.xp = prog.xp;

  if (ups > 0) {
    try {
      evo.checkAndSetPending(profile, userId, slot, prog.level);
    } catch (_) {
      // evo optional / defensive
    }
  }

  return { leveledUp: ups, level: prog.level, xp: prog.xp, atCap: prog.level >= MAX_LEVEL };
}

function handleChatXp({ userId, userName, message }) {
  const uid = String(userId || "").trim();
  const uname = String(userName || "").trim();
  const msg = String(message || "").trim();

  if (!uid) return { ok: false, reason: "no_user" };
  if (IGNORE_NAMES.has(uname.toLowerCase())) return { ok: false, reason: "ignored" };
  if (msg.startsWith("!")) return { ok: false, reason: "command" }; // ignore bot-commands

  const profiles = ensureProfiles();
  const profile = ensureUserProfile(profiles, uid, uname);

  // must have at least 1 mon in party
  const hasAny = profile.party?.slots?.some(Boolean);
  if (!hasAny) return { ok: false, reason: "no_party" };

  const last = Number(profile.chat?.lastXpAt || 0);
  if (now() - last < COOLDOWN_MS) return { ok: false, reason: "cooldown" };

  const active = findActiveSlot(profile);
  if (active === -1) return { ok: false, reason: "no_active" };

  const { leveledUp } = applyXpToMon(profile, uid, active, XP_ACTIVE);

  profile.chat.lastXpAt = now();
  profile.updatedAt = now();

  writeJson(PROFILES_JSON, profiles);

  // Update website/overlay party message file immediately
  try {
    if (party?.cmdParty) party.cmdParty(uid, uname, "!team");
  } catch (e) {
    err("xp.partyRender failed", e?.message || String(e));
  }

  log("xp.chat", { uid, uname, xp: XP_ACTIVE, activeSlot: active, leveledUp });

  return { ok: true, xp: XP_ACTIVE, leveledUp };
}

module.exports = { handleChatXp };
