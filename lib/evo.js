// local/lib/evo.js
const path = require("path");
const { ensureDirs, readJson, writeJson, writeText } = require("./fileStore");
const { log, err } = require("./logger");
const {
  OUT_DIR,
  DEXMAP_JSON,
  EVOLUTIONS_JSON,
  POKEDEX_JSON,
  PROFILES_JSON,
} = require("./paths");

const party = require("./party");
const items = require("./items");
function now() { return Date.now(); }

function evoOutFile(userId) {
  ensureDirs();
  return path.join(OUT_DIR, `evoMessage_${userId}.txt`);
}

// ----------------------
// Evolutions rules (cached)
// ----------------------
let EVO_CACHE = null;
function loadEvos() {
  if (EVO_CACHE) return EVO_CACHE;

  const raw = readJson(EVOLUTIONS_JSON, { version: 1, byDexId: {} });
  const byDexId = raw?.byDexId && typeof raw.byDexId === "object" ? raw.byDexId : {};
  EVO_CACHE = { version: raw?.version ?? 1, byDexId };
  return EVO_CACHE;
}

function getRule(fromDexId) {
  const evos = loadEvos();
  const r = evos.byDexId?.[String(fromDexId)];
  if (!r) return null;

  const level = Number(r.level);
  const toDexId = Number(r.toDexId);
  if (!Number.isFinite(level) || !Number.isFinite(toDexId)) return null;

  return { level, toDexId };
}

// ----------------------
// Dexmap helpers (cached)
// ----------------------
let DEX_CACHE = null;
let DEX_BY_ID = null;

function loadDexmap() {
  if (DEX_CACHE) return DEX_CACHE;
  const raw = readJson(DEXMAP_JSON, {});
  const byName = raw?.byName && typeof raw.byName === "object" ? raw.byName : raw;
  DEX_CACHE = byName && typeof byName === "object" ? byName : {};
  return DEX_CACHE;
}

function prettyDexName(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function indexDexById() {
  if (DEX_BY_ID) return DEX_BY_ID;
  const map = loadDexmap();
  const byId = {};

  // Unterstützt zwei Formate:
  // 1) Flat: { "bisasam": 1, ... }
  // 2) Objektbasiert: { "bisasam": { dexId: 1, ... }, ... } oder { byName: {...} }
  for (const [rawName, v] of Object.entries(map)) {
    const dexId = typeof v === "number" ? v : Number(v?.dexId);
    if (!Number.isFinite(dexId)) continue;

    if (typeof v === "number") {
      byId[dexId] ??= {
        dexId,
        name: prettyDexName(rawName),
        displayName: prettyDexName(rawName),
      };
    } else if (typeof v === "object" && v) {
      byId[dexId] ??= {
        ...v,
        dexId,
        name: v.name || v.displayName || prettyDexName(rawName),
        displayName: v.displayName || v.name || prettyDexName(rawName),
      };
    }
  }

  DEX_BY_ID = byId;
  return byId;
}

function officialArtworkUrl(dexId) {
  return dexId
    ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexId}.png`
    : null;
}

function monKey(userId, caughtAt) {
  return `${String(userId)}:${Number(caughtAt) || 0}`;
}

function ensureDexHistoryEntry(userEntry, mon, meta = {}) {
  if (!userEntry || !mon) return false;

  userEntry.dexHistory ??= [];

  const dexId = Number(mon.dexId);
  if (!dexId) return false;

  const ts = Number(meta.ts || Date.now()) || Date.now();

  const existing = userEntry.dexHistory.find(h =>
    h && Number(h.dexId) === dexId
  );

  if (existing) {
    existing.lastOwnedAt = ts;
    if (!existing.firstOwnedAt) existing.firstOwnedAt = ts;
    if (!existing.name) existing.name = mon.displayName || mon.name || `#${dexId}`;
    if (meta.via) existing.viaLast = String(meta.via);
    return false;
  }

  userEntry.dexHistory.push({
    dexId,
    name: mon.displayName || mon.name || `#${dexId}`,
    firstOwnedAt: ts,
    lastOwnedAt: ts,
    via: String(meta.via || "evolution"),
  });

  return true;
}

// ----------------------
// Stein-Evolutionen (Gen 1 / Kanto)
// ----------------------
const STONE_EVOS = {
  // Donnerstein
  25: { itemId: "thunder_stone", toDexId: 26, toName: "Raichu" },   // Pikachu
  133: {
    thunder_stone: { toDexId: 135, toName: "Blitza" },            // Evoli
    water_stone: { toDexId: 134, toName: "Aquana" },
    fire_stone: { toDexId: 136, toName: "Flamara" }
  },

  // Feuerstein
  37: { itemId: "fire_stone", toDexId: 38, toName: "Vulnona" },      // Vulpix
  58: { itemId: "fire_stone", toDexId: 59, toName: "Arkani" },       // Fukano

  // Wasserstein
  61: { itemId: "water_stone", toDexId: 62, toName: "Quappo" },      // Quaputzi
  90: { itemId: "water_stone", toDexId: 91, toName: "Austos" },      // Muschas
  120: { itemId: "water_stone", toDexId: 121, toName: "Starmie" },     // Sterndu

  // Blattstein
  44: { itemId: "leaf_stone", toDexId: 45, toName: "Giflor" },       // Duflor
  70: { itemId: "leaf_stone", toDexId: 71, toName: "Sarzenia" },     // Ultrigaria
  102: { itemId: "leaf_stone", toDexId: 103, toName: "Kokowei" },      // Owei

  // Mondstein
  30: { itemId: "moon_stone", toDexId: 31, toName: "Nidoqueen" },     // Nidorina
  33: { itemId: "moon_stone", toDexId: 34, toName: "Nidoking" },      // Nidorino
  35: { itemId: "moon_stone", toDexId: 36, toName: "Pixi" },          // Piepi
  39: { itemId: "moon_stone", toDexId: 40, toName: "Knuddeluff" },    // Pummeluff
};

function getStoneEvolutionRule(fromDexId, itemId) {
  const row = STONE_EVOS[Number(fromDexId)];
  if (!row) return null;

  // Sonderfall Evoli (mehrere Steine)
  if (row[itemId]) return { itemId, ...row[itemId] };

  // Normale 1-Stein-Zuordnung
  if (row.itemId && row.itemId === itemId) {
    return { itemId, toDexId: row.toDexId, toName: row.toName };
  }

  return null;
}

function findActivePartySlot(profile) {
  const slots = profile?.party?.slots || [];
  let active = Number(profile?.party?.activeSlot ?? 0);

  if (active < 0 || active >= slots.length || !slots[active]) {
    const first = slots.findIndex(Boolean);
    if (first === -1) return { index: -1, slot: null };
    profile.party.activeSlot = first;
    active = first;
  }

  return { index: active, slot: slots[active] || null };
}

// ----------------------
// Public: mark pending evolution (used by XP)
// ----------------------
function checkAndSetPending(profile, userId, slot, levelNow) {
  if (!profile || !slot?.caughtAt) return false;

  const fromDexId = Number(slot.dexId);
  if (!Number.isFinite(fromDexId)) return false;

  const rule = getRule(fromDexId);
  if (!rule) return false;

  const lv = Number(levelNow || 1);
  if (!Number.isFinite(lv) || lv < rule.level) return false;

  const key = monKey(userId, slot.caughtAt);

  profile.evoLocked ??= {}; // monKey -> true
  if (profile.evoLocked[key]) return false;

  if (profile.evoPending && profile.evoPending.monKey === key && Number(profile.evoPending.toDexId) === rule.toDexId) {
    return false;
  }

  const dexById = indexDexById();
  const toEntry = dexById[rule.toDexId] || { dexId: rule.toDexId };

  const fromName = slot.name || slot.displayName || `#${fromDexId}`;
  const toName = toEntry.name || toEntry.displayName || `#${rule.toDexId}`;

  profile.evoPending = {
    monKey: key,
    fromDexId,
    toDexId: rule.toDexId,
    atLevel: rule.level,
    fromName,
    toName,
    createdAt: now(),
  };

  log("evo.pending", { userId, key, fromDexId, toDexId: rule.toDexId, atLevel: rule.level });
  return true;
}

// ----------------------
// Apply evolution (triggered by !evo yes)
// ----------------------
function applyEvolution({ profiles, profile, userId, userName, pending }) {
  const dexById = indexDexById();

  const caughtAt = Number(String(pending.monKey).split(":")[1] || 0);
  if (!caughtAt) {
    profile.evoPending = null;
    return { ok: false, reason: "bad_monKey" };
  }

  const pokedex = readJson(POKEDEX_JSON, { users: {} }) || { users: {} };
  pokedex.users ??= {};
  const userEntry = pokedex.users[userId];
  if (!userEntry || !Array.isArray(userEntry.caught)) {
    profile.evoPending = null;
    return { ok: false, reason: "no_pokedex_user" };
  }

  const mon = userEntry.caught.find(m => Number(m?.caughtAt) === caughtAt);
  if (!mon) {
    profile.evoPending = null;
    return { ok: false, reason: "mon_not_found" };
  }

  const toDexId = Number(pending.toDexId);
  const toEntry = dexById[toDexId] || { dexId: toDexId };

  const newName = toEntry.name || toEntry.displayName || mon.name || `#${toDexId}`;
  const isShiny = !!mon.isShiny;

  mon.dexId = toDexId;
  mon.name = newName;
  mon.displayName = newName; // keep simple; your UI already adds shiny marker via isShiny
  mon.spriteUrl = toEntry.spriteUrl || officialArtworkUrl(toDexId);

  mon.evoHistory ??= [];
  mon.evoHistory.push({
    fromDexId: Number(pending.fromDexId),
    toDexId,
    atLevel: Number(pending.atLevel),
    at: now(),
  });

  ensureDexHistoryEntry(userEntry, mon, {
    ts: now(),
    via: "evolution",
  });

  // Update party slot reference too
  if (profile.party?.slots?.length) {
    for (let i = 0; i < profile.party.slots.length; i++) {
      const s = profile.party.slots[i];
      if (s && Number(s.caughtAt) === caughtAt) {
        s.dexId = toDexId;
        s.name = newName;
        s.displayName = newName;
        s.spriteUrl = mon.spriteUrl;
      }
    }
  }

  profile.evoPending = null;

  writeJson(POKEDEX_JSON, pokedex);
  writeJson(PROFILES_JSON, profiles);

  const msg = `🧬 @${userName} Entwicklung! ${pending.fromName} → ${newName} (Lv.${pending.atLevel})`;
  writeText(evoOutFile(userId), msg);

  // refresh website output (partyMessage_<uid>.txt)
  try { party.cmdParty(userId, userName, "!team"); } catch { }

  return { ok: true, toDexId, name: newName };
}

function applyStoneEvolution({ profiles, profile, userId, userName, stoneItemId }) {
  const uid = String(userId || "").trim();
  const uname = String(userName || "").trim() || "User";

  const { index: slotIndex, slot } = findActivePartySlot(profile);
  if (slotIndex === -1 || !slot) return { ok: false, reason: "no_active" };

  const fromDexId = Number(slot.dexId || 0);
  const rule = getStoneEvolutionRule(fromDexId, stoneItemId);
  if (!rule) return { ok: false, reason: "no_match", fromDexId, stoneItemId };

  // Item prüfen + verbrauchen
  const has = items.hasItem(profile, stoneItemId, 1);
  if (!has) return { ok: false, reason: "no_item", itemId: stoneItemId };

  const consume = items.consumeItem(profile, stoneItemId, 1);
  if (!consume.ok) return { ok: false, reason: consume.reason || "consume_failed", itemId: stoneItemId };

  const caughtAt = Number(slot.caughtAt || 0);
  if (!caughtAt) return { ok: false, reason: "bad_slot_caughtAt" };

  // Pokédex-Eintrag dieses konkreten gefangenen Mons finden
  const pokedex = readJson(POKEDEX_JSON, { users: {} }) || { users: {} };
  pokedex.users ??= {};
  const userEntry = pokedex.users[uid];
  if (!userEntry || !Array.isArray(userEntry.caught)) return { ok: false, reason: "no_pokedex_user" };

  const mon = userEntry.caught.find(m => Number(m?.caughtAt) === caughtAt);
  if (!mon) return { ok: false, reason: "mon_not_found" };

  const fromName = mon.displayName || mon.name || slot.displayName || slot.name || `#${fromDexId}`;
  const toDexId = Number(rule.toDexId);
  const toName = rule.toName;

  // Pokédex-Mon mutieren
  mon.dexId = toDexId;
  mon.name = toName;
  mon.displayName = toName;
  mon.spriteUrl = officialArtworkUrl(toDexId);

  mon.evoHistory ??= [];
  mon.evoHistory.push({
    method: "stone",
    itemId: stoneItemId,
    fromDexId,
    toDexId,
    at: now(),
  });

  ensureDexHistoryEntry(userEntry, mon, {
    ts: now(),
    via: "stone_evolution",
  });

  // Party-Slot synchronisieren
  slot.dexId = toDexId;
  slot.name = toName;
  slot.displayName = toName;
  slot.spriteUrl = mon.spriteUrl;

  // Optional: Level-Evo-Pending für altes Stadium entfernen
  if (profile.evoPending && profile.evoPending.monKey === monKey(uid, caughtAt)) {
    profile.evoPending = null;
  }

  // Wichtig: Lock für dieses Mon zurücksetzen, damit spätere Level-Evo-Stufe möglich bleibt
  if (profile.evoLocked) {
    delete profile.evoLocked[monKey(uid, caughtAt)];
  }

  writeJson(POKEDEX_JSON, pokedex);
  writeJson(PROFILES_JSON, profiles);

  const itemDef = items.ITEM_DEFS?.[stoneItemId];
  const itemLabel = itemDef?.label || stoneItemId;
  const itemEmoji = itemDef?.emoji || "🪨";

  writeText(
    evoOutFile(uid),
    `🧬 @${uname} entwickelt ${fromName} mit ${itemEmoji} ${itemLabel} zu ${toName}!`
  );

  try { party.cmdParty(uid, uname, "!team"); } catch { }

  log("evo.stone", { uid, uname, fromDexId, toDexId, stoneItemId });
  return { ok: true, method: "stone", fromDexId, toDexId, stoneItemId };
}

// ----------------------
// !evo command handler
// ----------------------
function handleEvo({ userId, userName, rawInput }) {
  ensureDirs();

  const profiles = readJson(PROFILES_JSON, { version: 1, users: {} }) || { version: 1, users: {} };
  profiles.users ??= {};

  // Ensure minimal profile shape (we reuse party/xp shape)
  const uid = String(userId || "").trim();
  if (!profiles.users[uid]) {
    profiles.users[uid] = {
      id: uid,
      display: String(userName || ""),
      createdAt: now(),
      updatedAt: now(),
      party: { activeSlot: 0, slots: Array.from({ length: 6 }, () => null) },
      progress: {},
      pending: null,
      chat: { lastXpAt: 0 },
      evoPending: null,
      evoLocked: {},
    };
  }

  const profile = profiles.users[uid];
  profile.evoLocked ??= {};
  const outFile = evoOutFile(uid);

  // Parse args: works with "yes" or "!evo yes"
  const tokens = String(rawInput || "").trim().split(/\s+/).filter(Boolean);
  const t0 = (tokens[0] || "").toLowerCase();
  let sub = t0;

  if (t0 === "!evo" || t0 === "evo" || t0 === "!evolution" || t0 === "evolution") {
    sub = (tokens[1] || "").toLowerCase();
  }

  // Helper: get active slot + level
  const slots = profile.party?.slots || [];
  const active = Number(profile.party?.activeSlot ?? 0);
  const activeSlot = slots[active] || null;
  const activeKey = activeSlot?.caughtAt ? monKey(uid, activeSlot.caughtAt) : null;
  const prog = activeKey ? profile.progress?.[activeKey] : null;
  const levelNow = Number(prog?.level || 1);

  // If no subcommand: show status / prompt
  if (!sub) {
    if (profile.evoPending) {
      const e = profile.evoPending;
      writeText(outFile, `🧬 @${userName} Entwicklung bereit: ${e.fromName} → ${e.toName} (ab Lv.${e.atLevel}) | !evo yes / !evo no`);
      writeJson(PROFILES_JSON, profiles);
      return { ok: true, shown: "pending" };
    }

    // Try to set pending if available
    const changed = activeSlot ? checkAndSetPending(profile, uid, activeSlot, levelNow) : false;
    writeJson(PROFILES_JSON, profiles);

    if (changed && profile.evoPending) {
      const e = profile.evoPending;
      writeText(outFile, `🧬 @${userName} Entwicklung bereit: ${e.fromName} → ${e.toName} (ab Lv.${e.atLevel}) | !evo yes / !evo no`);
      return { ok: true, shown: "new_pending" };
    }

    writeText(outFile, `ℹ️ @${userName} Keine Entwicklung verfügbar.`);
    return { ok: true, shown: "none" };
  }

  // USE <stone> = sofortige Stein-Evolution (ohne Bestätigung)
  if (sub === "use") {
    // funktioniert für:
    // !evo use feuerstein
    // !evo use fire_stone
    const stoneToken =
      (t0 === "!evo" || t0 === "evo" || t0 === "!evolution" || t0 === "evolution")
        ? (tokens[2] || "")
        : (tokens[1] || "");

    const stoneItemId = items.normalizeItemId(stoneToken);

    if (!stoneItemId) {
      writeText(outFile, `ℹ️ @${userName} Nutzung: !evo use <feuerstein|wasserstein|donnerstein|blattstein|mondstein>`);
      writeJson(PROFILES_JSON, profiles);
      return { ok: true, help: true };
    }

    const res = applyStoneEvolution({
      profiles,
      profile,
      userId: uid,
      userName,
      stoneItemId,
    });

    if (!res.ok) {
      if (res.reason === "no_active") {
        writeText(outFile, `⚠️ @${userName} Kein aktives Pokémon ausgewählt.`);
      } else if (res.reason === "no_item") {
        const def = items.ITEM_DEFS?.[stoneItemId];
        writeText(outFile, `❌ @${userName} Du hast keinen ${def?.emoji || ""} ${def?.label || stoneItemId}.`);
      } else if (res.reason === "no_match") {
        writeText(outFile, `❌ @${userName} Dein aktives Pokémon kann mit diesem Stein nicht entwickelt werden.`);
      } else {
        writeText(outFile, `⚠️ @${userName} Stein-Entwicklung fehlgeschlagen.`);
      }

      // Falls consume nicht passiert ist, profiles sicherheitshalber dennoch persistieren (z.B. activeSlot-Korrektur)
      try { writeJson(PROFILES_JSON, profiles); } catch { }
    }

    return res;
  }

  // YES
  if (sub === "yes" || sub === "y") {
    if (!profile.evoPending) {
      const changed = activeSlot ? checkAndSetPending(profile, uid, activeSlot, levelNow) : false;
      if (!changed || !profile.evoPending) {
        writeText(outFile, `ℹ️ @${userName} Keine Entwicklung verfügbar.`);
        writeJson(PROFILES_JSON, profiles);
        return { ok: true, evolved: false };
      }
    }

    const pending = profile.evoPending;
    const res = applyEvolution({ profiles, profile, userId: uid, userName, pending });
    // applyEvolution writes json + out
    return res;
  }

  // NO = lock this mon (stay forever in this stage unless unlocked later)
  if (sub === "no" || sub === "n") {
    const pending = profile.evoPending;
    if (!pending) {
      writeText(outFile, `ℹ️ @${userName} Keine pending Entwicklung zum Ablehnen.`);
      writeJson(PROFILES_JSON, profiles);
      return { ok: true, locked: false };
    }

    profile.evoLocked[pending.monKey] = true;
    profile.evoPending = null;

    writeJson(PROFILES_JSON, profiles);
    writeText(outFile, `🔒 @${userName} Entwicklung gesperrt für dieses Pokémon. (Du bleibst auf der Stufe)`);
    try { party.cmdParty(uid, userName, "!team"); } catch { }
    return { ok: true, locked: true };
  }

  // UNLOCK (optional)
  if (sub === "unlock") {
    if (!activeKey) {
      writeText(outFile, `⚠️ @${userName} Kein aktives Pokémon.`);
      writeJson(PROFILES_JSON, profiles);
      return { ok: false, reason: "no_active" };
    }

    delete profile.evoLocked[activeKey];
    writeJson(PROFILES_JSON, profiles);
    writeText(outFile, `🔓 @${userName} Entwicklung wieder erlaubt für dein aktives Pokémon.`);
    return { ok: true, unlocked: true };
  }

  writeText(outFile, `ℹ️ @${userName} Nutzung: !evo | !evo yes | !evo no`);
  writeJson(PROFILES_JSON, profiles);
  return { ok: true, help: true };
}

module.exports = { checkAndSetPending, handleEvo };
