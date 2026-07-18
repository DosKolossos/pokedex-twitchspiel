const party = require("./party");
const { readJson, writeJson, writeText, ensureDirs } = require("./fileStore");
const { log, err } = require("./logger");
const { POKEDEX_JSON, TRADES_JSON, PROFILES_JSON, tradeMessageFile } = require("./paths");


// ----------------------
// Helpers
// ----------------------
function now() { return Date.now(); }

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/^✨\s*shiny\s*/i, "")
    .replace(/♀/g, "f").replace(/♂/g, "m")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function normPokeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/^✨\s*shiny\s*/i, "")
    .replace(/♀/g, "f").replace(/♂/g, "m")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function ensureDexHistoryEntry(userEntry, mon, meta = {}) {
  if (!userEntry || !mon) return false;
  userEntry.dexHistory ??= [];

  const existing = userEntry.dexHistory.find((h) => {
    if (!h) return false;
    if (mon?.dexId != null && h.dexId != null) return Number(h.dexId) === Number(mon.dexId);
    return String(h?.name || "").toLowerCase() === String(mon?.name || mon?.displayName || "").toLowerCase();
  });

  const ts = Number(meta.ts || now()) || now();
  if (existing) {
    existing.lastOwnedAt = ts;
    if (!existing.firstOwnedAt) existing.firstOwnedAt = ts;
    if (!existing.name) existing.name = mon?.name || mon?.displayName || "?";
    if (existing.dexId == null && mon?.dexId != null) existing.dexId = mon.dexId;
    if (meta.via) existing.viaLast = String(meta.via);
    return false;
  }

  userEntry.dexHistory.push({
    dexId: mon?.dexId ?? null,
    name: mon?.name || mon?.displayName || "?",
    firstOwnedAt: ts,
    lastOwnedAt: ts,
    via: String(meta.via || "trade"),
  });
  return true;
}

function markTradeHistoryBothSides(fromEntry, toEntry, wantPokemon, offerPokemon) {
  const ts = now();
  // Nach dem Trade besitzt fromEntry das wantPokemon, toEntry das offerPokemon.
  ensureDexHistoryEntry(fromEntry, wantPokemon, { ts, via: "trade_received" });
  ensureDexHistoryEntry(toEntry, offerPokemon, { ts, via: "trade_received" });

  // Historisch zusätzlich auch die abgegebenen Pokémon festhalten (falls Altbestand keine Historie hatte)
  ensureDexHistoryEntry(fromEntry, offerPokemon, { ts, via: "trade_given" });
  ensureDexHistoryEntry(toEntry, wantPokemon, { ts, via: "trade_given" });
}

function describePokemon(p) {
  const shiny = p?.isShiny ? "✨ " : "";
  const n = p?.name || p?.displayName || "???";
  const r = String(p?.rarity || "").toUpperCase();
  return `${shiny}${n}${r ? ` (${r})` : ""}`;
}

// --- Tauschevolutionen (Kanto) ---
const TRADE_EVOS = {
  64: { toDexId: 65, toName: "Simsala" },  // Kadabra -> Simsala
  67: { toDexId: 68, toName: "Machomei" }, // Maschock -> Machomei
  75: { toDexId: 76, toName: "Geowaz" },   // Georok -> Geowaz
  93: { toDexId: 94, toName: "Gengar" },   // Alpollo -> Gengar
};

function officialArtworkUrl(dexId) {
  const id = Number(dexId || 0);
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

/**
 * Mutiert das Pokémon-Objekt (dexId/name/displayName/spriteUrl),
 * falls es eine Tauschevolution hat.
 * @returns {string} Evolutions-Text für die Trade-Message (oder "")
 */
function applyTradeEvolution(mon) {
  const fromDexId = Number(mon?.dexId || 0);
  const evo = TRADE_EVOS[fromDexId];
  if (!evo) return "";

  const fromName = mon?.displayName || mon?.name || `#${fromDexId}`;

  mon.dexId = evo.toDexId;
  mon.name = evo.toName;
  mon.displayName = evo.toName;
  mon.spriteUrl = officialArtworkUrl(evo.toDexId);

  return `${fromName} → ${evo.toName}`;
}


const PARTY_SIZE = 6;

function partyMonKey(userId, caughtAt) {
  return `${String(userId)}:${Number(caughtAt) || 0}`;
}

function readProfiles() {
  const base = { version: 1, users: {} };
  const p = readJson(PROFILES_JSON, base);
  if (!p || typeof p !== "object") return base;
  if (!p.users || typeof p.users !== "object") p.users = {};
  if (!p.version) p.version = 1;
  return p;
}

// Wir updaten nur bestehende Profile (User, die nie !team genutzt haben, brauchen kein Auto-Update)
function getExistingProfile(profiles, userId, display) {
  const u = profiles.users?.[userId];
  if (!u) return null;

  u.display = String(display || u.display || "");
  u.party ??= { activeSlot: 0, slots: Array.from({ length: PARTY_SIZE }, () => null) };
  u.party.slots ??= Array.from({ length: PARTY_SIZE }, () => null);

  if (u.party.slots.length !== PARTY_SIZE) {
    const old = u.party.slots;
    u.party.slots = Array.from({ length: PARTY_SIZE }, (_, i) => old[i] ?? null);
  }

  u.progress ??= {};
  return u;
}

function ensureProgress(profile, key) {
  profile.progress ??= {};
  if (!profile.progress[key]) {
    profile.progress[key] = { xp: 0, level: 1, createdAt: now(), updatedAt: now() };
  }
  return profile.progress[key];
}

function buildPartySlotEntry(userId, mon, prog) {
  return {
    monKey: partyMonKey(userId, mon.caughtAt),
    name: mon.name || mon.displayName,
    displayName: mon.displayName || mon.name,
    dexId: mon.dexId ?? null,
    spriteUrl: mon.spriteUrl ?? null,
    rarity: mon.rarity ?? null,
    isShiny: !!mon.isShiny,
    caughtAt: mon.caughtAt ?? null,
    level: prog?.level ?? 1,
    xp: prog?.xp ?? 0,
  };
}

// Entfernt/ersetzt Party-Slot + entfernt Progress des abgegebenen Mons
function syncPartyAfterTrade(profiles, ownerId, ownerDisplay, gaveMon, gotMon) {
  const profile = getExistingProfile(profiles, ownerId, ownerDisplay);
  if (!profile) return false;

  let changed = false;

  const gaveTs = Number(gaveMon?.caughtAt || 0);
  if (!gaveTs) return false;

  const gaveKey = partyMonKey(ownerId, gaveTs);

  // progress cleanup (auch wenn Mon nicht in Party war)
  if (profile.progress?.[gaveKey]) {
    delete profile.progress[gaveKey];
    changed = true;
  }

  const idx = profile.party.slots.findIndex(s =>
    s && (Number(s.caughtAt || 0) === gaveTs || s.monKey === gaveKey)
  );

  if (idx === -1) return changed;

  // Wenn Slot betroffen: versuchen zu ersetzen (statt leer machen)
  const gotTs = Number(gotMon?.caughtAt || 0);
  const gotKey = partyMonKey(ownerId, gotTs);

  const alreadyHasGot =
    gotTs &&
    profile.party.slots.some(s => s && (Number(s.caughtAt || 0) === gotTs || s.monKey === gotKey));

  if (gotTs && !alreadyHasGot) {
    const prog = ensureProgress(profile, gotKey);
    profile.party.slots[idx] = buildPartySlotEntry(ownerId, gotMon, prog);
  } else {
    profile.party.slots[idx] = null;

    // activeSlot korrigieren, falls der auf den entfernten Slot zeigte
    if ((profile.party.activeSlot ?? 0) === idx) {
      const first = profile.party.slots.findIndex(Boolean);
      profile.party.activeSlot = first === -1 ? 0 : first;
    }
  }

  return true;
}


// Backward-compat migration
function migratePokedexIfNeeded(pokedex) {
  if (!pokedex || typeof pokedex !== "object") return { users: {} };
  if (!pokedex.users || typeof pokedex.users !== "object") pokedex.users = {};

  const entries = Object.entries(pokedex.users);
  const hasLegacy = entries.some(([, v]) => Array.isArray(v));
  if (!hasLegacy) return pokedex;

  const next = { users: {} };
  for (const [key, val] of entries) {
    if (Array.isArray(val)) {
      const display = key;
      const id = `legacy:${display}`;
      next.users[id] = { id, display, caught: val };
    } else if (val && typeof val === "object") {
      const id = String(val.id ?? key);
      const display = String(val.display ?? key);
      const caught = Array.isArray(val.caught) ? val.caught : [];
      next.users[id] = { id, display, caught };
    }
  }
  return next;
}

// ----------------------
// Trades store
// ----------------------
function readTrades() {
  const t = readJson(TRADES_JSON, { nextId: 1, pending: {} });
  if (!t.pending) t.pending = {};
  if (!t.nextId) t.nextId = 1;
  return t;
}
function writeTrades(t) { writeJson(TRADES_JSON, t); }

function cleanupTrades(t) {
  const ts = now();
  for (const [id, tr] of Object.entries(t.pending || {})) {
    if ((tr?.expiresAt ?? 0) <= ts) delete t.pending[id];
  }
  return t;
}

function findUserIdByMention(pokedex, mention) {
  const q = normName(mention);
  for (const u of Object.values(pokedex.users || {})) {
    if (normName(u?.display) === q) return u.id;
  }
  return null;
}

function findLatestByName(entry, name) {
  const inv = Array.isArray(entry?.caught) ? entry.caught : [];
  const q = normPokeName(name);
  const sorted = [...inv].sort((a, b) => (b?.caughtAt ?? 0) - (a?.caughtAt ?? 0));
  return sorted.find(p => normPokeName(p?.name || p?.displayName) === q) || null;
}

function parseTradeLine(rawInput) {
  const rest = String(rawInput || "").replace(/^\s*!?trade\b/i, "").trim();
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;

  const mention = parts[0];
  const offered = parts[parts.length - 1];
  const wanted = parts.slice(1, -1).join(" ");

  return { mention, wanted, offered };
}

function parseIdFromCommand(rawInput, cmd) {
  const rest = String(rawInput || "").replace(new RegExp(`^\\s*!?${cmd}\\b`, "i"), "").trim();
  return rest.split(/\s+/).filter(Boolean)[0] || "";
}

// ----------------------
// Public API
// ----------------------

function handleTrade({ userId, userName, rawInput }) {
  ensureDirs();
  const fromId = String(userId || "").trim();
  const fromDisplay = String(userName || "").trim();
  const outFile = tradeMessageFile(fromId);

  log("trade.handleTrade", { fromId, fromDisplay, rawInput });

  let pokedex = migratePokedexIfNeeded(readJson(POKEDEX_JSON, { users: {} }));

  const parsed = parseTradeLine(rawInput);
  if (!parsed) {
    writeText(outFile, `❌ Nutzung: !trade @User <PokemonVonUser> <DeinPokemon> | Beispiel: !trade @DosKolossos_Dev Glurak Karpador`);
    return { ok: false, reason: "bad_syntax" };
  }

  const { mention, wanted, offered } = parsed;

  const toId = findUserIdByMention(pokedex, mention);
  if (!toId) {
    writeText(outFile, `❌ Ich kenne "${mention}" noch nicht (hat wohl noch nichts gefangen).`);
    return { ok: false, reason: "unknown_user" };
  }

  const fromEntry = pokedex.users[fromId];
  const toEntry = pokedex.users[toId];

  if (!fromEntry?.caught?.length) {
    writeText(outFile, `❌ @${fromDisplay} du hast keine Pokémon zum Tauschen.`);
    return { ok: false, reason: "no_inventory" };
  }
  if (!toEntry?.caught?.length) {
    writeText(outFile, `❌ ${mention} hat noch keine Pokémon.`);
    return { ok: false, reason: "target_no_inventory" };
  }

  const offerP = findLatestByName(fromEntry, offered);
  if (!offerP) {
    writeText(outFile, `❌ Du besitzt "${offered}" nicht (oder Name stimmt nicht).`);
    return { ok: false, reason: "no_offer" };
  }

  const wantP = findLatestByName(toEntry, wanted);
  if (!wantP) {
    writeText(outFile, `❌ ${mention} besitzt "${wanted}" nicht (oder Name stimmt nicht).`);
    return { ok: false, reason: "no_want" };
  }

  let trades = cleanupTrades(readTrades());
  const id = String(trades.nextId++);

  trades.pending[id] = {
    id,
    fromId,
    fromDisplay,
    toId,
    toDisplay: toEntry.display || mention.replace(/^@/, ""),
    offer: offerP,
    want: wantP,
    createdAt: now(),
    expiresAt: now() + 2 * 60_000,
  };

  writeTrades(trades);

  writeText(
    outFile,
    `🧾 Trade #${id}: @${fromDisplay} bietet ${describePokemon(offerP)} für ${mention}’s ${describePokemon(wantP)}. ` +
    `${mention} → !accept ${id} | !decline ${id}`
  );

  return { ok: true, tradeId: id, toId };
}

function handleAccept({ userId, userName, rawInput }) {
  ensureDirs();
  const toId = String(userId || "").trim();
  const toDisplay = String(userName || "").trim();
  const outFile = tradeMessageFile(toId);

  log("trade.handleAccept", { toId, toDisplay, rawInput });

  const tradeId = parseIdFromCommand(rawInput, "accept");
  if (!tradeId) {
    writeText(outFile, `❌ Nutzung: !accept <TradeId>`);
    return { ok: false, reason: "bad_syntax" };
  }

  let trades = cleanupTrades(readTrades());
  const tr = trades.pending?.[String(tradeId)];
  if (!tr) {
    writeText(outFile, `❌ Trade #${tradeId} existiert nicht (oder ist abgelaufen).`);
    return { ok: false, reason: "missing_trade" };
  }
  if (tr.toId !== toId) {
    writeText(outFile, `❌ Trade #${tradeId} ist nicht für dich.`);
    return { ok: false, reason: "not_for_you" };
  }

  let pokedex = migratePokedexIfNeeded(readJson(POKEDEX_JSON, { users: {} }));

  const fromEntry = pokedex.users[tr.fromId];
  const toEntry = pokedex.users[toId];

  if (!fromEntry?.caught?.length || !toEntry?.caught?.length) {
    delete trades.pending[String(tradeId)];
    writeTrades(trades);
    writeText(outFile, `❌ Trade #${tradeId} nicht mehr möglich (Inventar fehlt).`);
    return { ok: false, reason: "missing_inventory" };
  }

  // find by caughtAt + normalized name (stable enough)
  const offerIdx = fromEntry.caught.findIndex(p =>
    (p?.caughtAt ?? 0) === (tr.offer?.caughtAt ?? -1) &&
    normPokeName(p?.name || p?.displayName) === normPokeName(tr.offer?.name || tr.offer?.displayName)
  );

  const wantIdx = toEntry.caught.findIndex(p =>
    (p?.caughtAt ?? 0) === (tr.want?.caughtAt ?? -1) &&
    normPokeName(p?.name || p?.displayName) === normPokeName(tr.want?.name || tr.want?.displayName)
  );

  if (offerIdx === -1 || wantIdx === -1) {
    delete trades.pending[String(tradeId)];
    writeTrades(trades);
    writeText(outFile, `❌ Trade #${tradeId} nicht mehr möglich (Pokémon wurde verändert/fehlt).`);
    return { ok: false, reason: "missing_pokemon" };
  }

  const offerPokemon = fromEntry.caught.splice(offerIdx, 1)[0];
  const wantPokemon = toEntry.caught.splice(wantIdx, 1)[0];

  // Für die Message merken wir uns, was wirklich "gegeben" wurde (pre-evo)
  const offerDescBefore = describePokemon(offerPokemon);
  const wantDescBefore = describePokemon(wantPokemon);

  // Trade-Evos passieren beim Empfänger:
  // - Initiator (tr.fromId) bekommt wantPokemon
  // - Accepter (toId) bekommt offerPokemon
  const evoMsgFrom = applyTradeEvolution(wantPokemon);
  const evoMsgTo = applyTradeEvolution(offerPokemon);

  // refresh display names
  fromEntry.display = tr.fromDisplay;
  toEntry.display = toDisplay;

  // swap (IMPORTANT: push exactly once each)
  fromEntry.caught.push(wantPokemon);
  toEntry.caught.push(offerPokemon);

  // Historischer Dex: einmal besessen = dauerhaft im Dex
  markTradeHistoryBothSides(fromEntry, toEntry, wantPokemon, offerPokemon);

  writeJson(POKEDEX_JSON, pokedex);

  // ✅ Party sofort nach Trade synchronisieren + Website/Overlay updaten
  try {
    const profiles = readProfiles();
    profiles.users ??= {};

    // Initiator (tr.fromId) gibt offerPokemon ab und bekommt wantPokemon
    const a = syncPartyAfterTrade(profiles, tr.fromId, tr.fromDisplay, offerPokemon, wantPokemon);

    // Accepter (toId) gibt wantPokemon ab und bekommt offerPokemon
    const b = syncPartyAfterTrade(profiles, toId, toDisplay, wantPokemon, offerPokemon);

    if (a || b) {
      writeJson(PROFILES_JSON, profiles);

      // ✅ Website/Overlay sofort aktualisieren: partyMessage_*.txt neu schreiben
      if (party?.cmdParty) {
        if (profiles.users?.[tr.fromId]) party.cmdParty(tr.fromId, tr.fromDisplay, "!team");
        if (profiles.users?.[toId]) party.cmdParty(toId, toDisplay, "!team");
      }
    }
  } catch (e) {
    err("trade.partySync/render failed", e?.message || String(e));
  }



  delete trades.pending[String(tradeId)];
  writeTrades(trades);

  const evoExtra =
    (evoMsgFrom ? ` | 🧬 @${tr.fromDisplay}: ${evoMsgFrom}` : "") +
    (evoMsgTo ? ` | 🧬 @${toDisplay}: ${evoMsgTo}` : "");

writeText(
  outFile,
  `🔁 Trade #${tradeId}: @${tr.fromDisplay} ⇄ @${toDisplay} | ` +
  `${tr.fromDisplay} bekam ${describePokemon(wantPokemon)} | ` +
  `${toDisplay} bekam ${describePokemon(offerPokemon)}`
);

  // Optional: also write to initiator's file (nice UX)
  try {
    writeText(
      tradeMessageFile(tr.fromId),
      `🔁 Trade #${tradeId} abgeschlossen mit @${toDisplay}! ` +
      `Du hast ${describePokemon(wantPokemon)} erhalten und ${offerDescBefore} abgegeben.` +
      (evoMsgFrom ? ` | 🧬 ${evoMsgFrom}` : "")
    );
  } catch { }

  return { ok: true, tradeId };
}

function handleDecline({ userId, rawInput }) {
  ensureDirs();
  const toId = String(userId || "").trim();
  const outFile = tradeMessageFile(toId);

  log("trade.handleDecline", { toId, rawInput });

  const tradeId = parseIdFromCommand(rawInput, "decline");
  if (!tradeId) {
    writeText(outFile, `❌ Nutzung: !decline <TradeId>`);
    return { ok: false, reason: "bad_syntax" };
  }

  let trades = cleanupTrades(readTrades());
  const tr = trades.pending?.[String(tradeId)];
  if (!tr) {
    writeText(outFile, `❌ Trade #${tradeId} existiert nicht (oder ist abgelaufen).`);
    return { ok: false, reason: "missing_trade" };
  }
  if (tr.toId !== toId) {
    writeText(outFile, `❌ Trade #${tradeId} ist nicht für dich.`);
    return { ok: false, reason: "not_for_you" };
  }

  delete trades.pending[String(tradeId)];
  writeTrades(trades);

  writeText(outFile, `🚫 Trade #${tradeId} wurde abgelehnt.`);

  // Optional info to initiator
  try { writeText(tradeMessageFile(tr.fromId), `🚫 Trade #${tradeId} wurde von @${tr.toDisplay} abgelehnt.`); } catch { }

  return { ok: true, tradeId };
}

function handleCancel({ userId, rawInput }) {
  ensureDirs();
  const fromId = String(userId || "").trim();
  const outFile = tradeMessageFile(fromId);

  log("trade.handleCancel", { fromId, rawInput });

  const tradeId = parseIdFromCommand(rawInput, "cancel");
  if (!tradeId) {
    writeText(outFile, `❌ Nutzung: !cancel <TradeId>`);
    return { ok: false, reason: "bad_syntax" };
  }

  let trades = cleanupTrades(readTrades());
  const tr = trades.pending?.[String(tradeId)];
  if (!tr) {
    writeText(outFile, `❌ Trade #${tradeId} existiert nicht (oder ist abgelaufen).`);
    return { ok: false, reason: "missing_trade" };
  }
  if (tr.fromId !== fromId) {
    writeText(outFile, `❌ Trade #${tradeId} gehört nicht dir.`);
    return { ok: false, reason: "not_yours" };
  }

  delete trades.pending[String(tradeId)];
  writeTrades(trades);

  writeText(outFile, `🛑 Trade #${tradeId} wurde abgebrochen.`);

  // Optional info to target
  try { writeText(tradeMessageFile(tr.toId), `🛑 Trade #${tradeId} wurde abgebrochen.`); } catch { }

  return { ok: true, tradeId };
}

module.exports = {
  handleTrade,
  handleAccept,
  handleDecline,
  handleCancel,
};
