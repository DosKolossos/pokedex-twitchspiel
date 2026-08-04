// local/lib/items.js
const path = require("path");
const { readJson, writeJson, writeText, ensureDirs } = require("./fileStore");
const { PROFILES_JSON, OUT_DIR } = require("./paths");
const { log, err } = require("./logger");
const party = require("./party");

const ITEM_DEFS = {
  fire_stone: {
    label: "Feuerstein",
    emoji: "🔥",
    aliases: ["fire_stone", "feuerstein", "feuer", "fire"],
  },
  water_stone: {
    label: "Wasserstein",
    emoji: "💧",
    aliases: ["water_stone", "wasserstein", "wasser", "water"],
  },
  thunder_stone: {
    label: "Donnerstein",
    emoji: "⚡",
    aliases: ["thunder_stone", "donnerstein", "donner", "thunder"],
  },
  leaf_stone: {
    label: "Blattstein",
    emoji: "🌿",
    aliases: ["leaf_stone", "blattstein", "blatt", "leaf"],
  },
  moon_stone: {
    label: "Mondstein",
    emoji: "🌙",
    aliases: ["moon_stone", "mondstein", "mond", "moon"],
  },
  xp_candy_s: {
    label: "XP-Bonbon S",
    emoji: "🍬",
    aliases: ["xp_candy_s", "bonbon_s", "xps", "candy_s"],
  },
  xp_candy_m: {
    label: "XP-Bonbon M",
    emoji: "🍬",
    aliases: ["xp_candy_m", "bonbon_m", "xpm", "candy_m"],
  },
  xp_candy_l: {
    label: "XP-Bonbon L",
    emoji: "🍬",
    aliases: ["xp_candy_l", "bonbon_l", "xpl", "candy_l"],
  },
};
const ITEM_ORDER = [
  "fire_stone",
  "water_stone",
  "thunder_stone",
  "leaf_stone",
  "moon_stone",
  "xp_candy_s",
  "xp_candy_m",
  "xp_candy_l",
];

function now() { return Date.now(); }

function itemOutFile(userId) {
  ensureDirs();
  return path.join(OUT_DIR, `itemMessage_${userId}.txt`);
}

function normalizeItemId(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return null;

  for (const [id, def] of Object.entries(ITEM_DEFS)) {
    if (id === raw) return id;
    if (def.aliases?.includes(raw)) return id;
  }
  return null;
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
      party: { activeSlot: 0, slots: Array.from({ length: 6 }, () => null) },
      progress: {},
      pending: null,
      chat: { lastXpAt: 0 },
      items: {},
    };
  } else {
    const u = profiles.users[uid];
    u.display = String(display || u.display || "");
    u.updatedAt = now();
    u.items ??= {};
  }

  // Alle bekannten Items immer initialisieren (damit Ausgabe sauber ist)
  for (const itemId of ITEM_ORDER) {
    if (!Number.isFinite(Number(profiles.users[uid].items[itemId]))) {
      profiles.users[uid].items[itemId] = 0;
    }
  }

  return profiles.users[uid];
}

function renderItemsLine(userName, profile) {
  const inv = profile.items || {};
  const parts = ITEM_ORDER.map((id) => {
    const def = ITEM_DEFS[id];
    const n = Number(inv[id] || 0);
    return `${def.emoji} ${def.label}: ${n}`;
  });

  return `🎒 Items von @${userName}: ${parts.join(" | ")} | Nutzung (später): !evo use <stein>`;
}

function writeItemsMessage(userId, userName, profile) {
  const file = itemOutFile(userId);
  writeText(file, renderItemsLine(userName, profile));
}

function parseGrantRaw(rawInput) {
  // supports:
  //   "fire_stone 1"
  //   "Feuerstein"
  //   "feuerstein 3"
  const parts = String(rawInput || "").trim().split(/\s+/).filter(Boolean);
  const itemToken = parts[0] || "";
  const amount = Math.max(1, Number(parts[1] || 1) || 1);
  return { itemToken, amount };
}

function handleItems({ userId, userName }) {
  const uid = String(userId || "").trim();
  const uname = String(userName || "").trim() || "User";
  if (!uid) return { ok: false, reason: "no_user" };

  try {
    const profiles = ensureProfiles();
    const profile = ensureUserProfile(profiles, uid, uname);
    writeJson(PROFILES_JSON, profiles); // persist defaults if missing
    writeItemsMessage(uid, uname, profile);
    log("items.show", { uid, uname });
    return { ok: true };
  } catch (e) {
    err("items.show failed", e?.message || String(e));
    return { ok: false, reason: "exception" };
  }
}

function handleGrantItem({ userId, userName, rawInput, itemId, amount }) {
  const uid = String(userId || "").trim();
  const uname = String(userName || "").trim() || "User";
  if (!uid) return { ok: false, reason: "no_user" };

  try {
    let parsedItemId = itemId ? normalizeItemId(itemId) : null;
    let parsedAmount = Math.max(1, Number(amount || 1) || 1);

    if (!parsedItemId) {
      const p = parseGrantRaw(rawInput);
      parsedItemId = normalizeItemId(p.itemToken);
      parsedAmount = p.amount;
    }

    if (!parsedItemId) {
      const file = itemOutFile(uid);
      writeText(file, `❌ Unbekanntes Item. Erlaubt: ${ITEM_ORDER.join(", ")}`);
      return { ok: false, reason: "unknown_item" };
    }

    const profiles = ensureProfiles();
    const profile = ensureUserProfile(profiles, uid, uname);

    profile.items[parsedItemId] = Number(profile.items[parsedItemId] || 0) + parsedAmount;
    profile.updatedAt = now();

    writeJson(PROFILES_JSON, profiles);

    const def = ITEM_DEFS[parsedItemId];
    writeText(
      itemOutFile(uid),
      `✅ @${uname} erhält ${parsedAmount}x ${def.emoji} ${def.label}. Jetzt: ${profile.items[parsedItemId]}`
    );

    log("items.grant", { uid, uname, itemId: parsedItemId, amount: parsedAmount, total: profile.items[parsedItemId] });
    return { ok: true, itemId: parsedItemId, amount: parsedAmount, total: profile.items[parsedItemId] };
  } catch (e) {
    err("items.grant failed", e?.message || String(e));
    return { ok: false, reason: "exception" };
  }
}

// Für spätere Stein-Evos (Phase B)
function hasItem(profile, itemId, amount = 1) {
  const id = normalizeItemId(itemId);
  if (!id) return false;
  return Number(profile?.items?.[id] || 0) >= Math.max(1, Number(amount) || 1);
}

function consumeItem(profile, itemId, amount = 1) {
  const id = normalizeItemId(itemId);
  const n = Math.max(1, Number(amount) || 1);
  if (!id) return { ok: false, reason: "unknown_item" };

  profile.items ??= {};
  const cur = Number(profile.items[id] || 0);
  if (cur < n) return { ok: false, reason: "not_enough", itemId: id, have: cur, need: n };

  profile.items[id] = cur - n;
  return { ok: true, itemId: id, left: profile.items[id] };
}

const XP_CANDY_VALUES = {
  xp_candy_s: 100,
  xp_candy_m: 250,
  xp_candy_l: 600,
};
const MAX_LEVEL = 100;

function partyMonKey(userId, caughtAt) {
  return `${String(userId)}:${Number(caughtAt) || 0}`;
}

function xpToNext(level) {
  // identisch zu xp.js halten
  const lv = Math.max(1, Number(level) || 1);
  return 40 + lv * 20;
}

function findActiveSlot(profile) {
  const slots = profile.party?.slots || [];
  let active = Number(profile.party?.activeSlot ?? 0);

  if (active < 0 || active >= slots.length || !slots[active]) {
    const first = slots.findIndex(Boolean);
    if (first === -1) return { index: -1, slot: null };
    profile.party.activeSlot = first;
    active = first;
  }

  return { index: active, slot: slots[active] || null };
}

function applyXpToActiveFromCandy(profile, userId, xpGain) {
  const { index, slot } = findActiveSlot(profile);
  if (index === -1 || !slot?.caughtAt) return { ok: false, reason: "no_active" };

  profile.progress ??= {};
  const key = partyMonKey(userId, slot.caughtAt);

  if (!profile.progress[key]) {
    profile.progress[key] = {
      xp: 0,
      level: 1,
      createdAt: now(),
      updatedAt: now(),
    };
  }

  const prog = profile.progress[key];

  // Legacy-Werte härten (z. B. alte >100 Levelstände)
  prog.level = Math.max(1, Number(prog.level || 1) || 1);
  prog.xp = Math.max(0, Number(prog.xp || 0) || 0);
  if (prog.level >= MAX_LEVEL) {
    prog.level = MAX_LEVEL;
    prog.xp = 0;
  } else {
    prog.xp += Number(xpGain || 0);
  }

  let leveledUp = 0;
  while (prog.level < MAX_LEVEL && prog.xp >= xpToNext(prog.level)) {
    prog.xp -= xpToNext(prog.level);
    prog.level = Number(prog.level || 1) + 1;
    leveledUp++;
  }

  if (prog.level >= MAX_LEVEL) {
    prog.level = MAX_LEVEL;
    prog.xp = 0; // kein Overflow über Lv.100 hinaus
  }

  prog.updatedAt = now();

  // Party-Slot für UI synchron halten
  slot.level = prog.level;
  slot.xp = prog.xp;

  return {
    ok: true,
    slotIndex: index,
    slot,
    key,
    xpGain: Number(xpGain || 0),
    leveledUp,
    level: prog.level,
    xp: prog.xp,
    atCap: prog.level >= MAX_LEVEL,
  };
}

function handleItemUse({ userId, userName, rawInput }) {
  const uid = String(userId || "").trim();
  const uname = String(userName || "").trim() || "User";
  if (!uid) return { ok: false, reason: "no_user" };

  try {
    const profiles = ensureProfiles();
    const profile = ensureUserProfile(profiles, uid, uname);

    const tokens = String(rawInput || "").trim().split(/\s+/).filter(Boolean);
    // Erwartet: !item use <item>
    // oder: item use <item>
    const t0 = (tokens[0] || "").toLowerCase();
    let sub = t0;

    if (t0 === "!item" || t0 === "item") {
      sub = (tokens[1] || "").toLowerCase();
    }

    if (!sub || sub === "help") {
      writeText(
        itemOutFile(uid),
        `ℹ️ @${uname} Nutzung: !item use <xp_bonbon> [anzahl] | Beispiele: !item use xp_candy_s | !item use xp_candy_l 3`
      );
      writeJson(PROFILES_JSON, profiles);
      return { ok: true, help: true };
    }

    if (sub !== "use") {
      writeText(itemOutFile(uid), `ℹ️ @${uname} Unbekannter Item-Befehl. Nutze: !item use <item>`);
      writeJson(PROFILES_JSON, profiles);
      return { ok: true, help: true };
    }

    const itemToken =
      (t0 === "!item" || t0 === "item")
        ? (tokens[2] || "")
        : (tokens[1] || "");

    const amountToken =
      (t0 === "!item" || t0 === "item")
        ? (tokens[3] || "1")
        : (tokens[2] || "1");

    let amount = Number(amountToken);
    if (!Number.isFinite(amount) || amount < 1) amount = 1;
    amount = Math.floor(amount);

    // optionaler Sicherheitsdeckel gegen Spam/Fehleingaben
    if (amount > 99) amount = 99;

    const itemId = normalizeItemId(itemToken);
    if (!itemId) {
      writeText(itemOutFile(uid), `❌ @${uname} Unbekanntes Item.`);
      writeJson(PROFILES_JSON, profiles);
      return { ok: false, reason: "unknown_item" };
    }

    // Nur XP-Bonbons über !item use (Steine laufen weiter über !evo use ...)
    const xpPerCandy = XP_CANDY_VALUES[itemId];
    if (!xpPerCandy) {
      writeText(itemOutFile(uid), `ℹ️ @${uname} Dieses Item nutzt du aktuell über !evo use <stein>.`);
      writeJson(PROFILES_JSON, profiles);
      return { ok: true, wrong_route: true };
    }

    // Prüfen, ob aktives Pokémon existiert (bevor Item verbraucht wird)
    const activeCheck = findActiveSlot(profile);
    if (activeCheck.index === -1 || !activeCheck.slot) {
      writeText(itemOutFile(uid), `⚠️ @${uname} Kein aktives Pokémon in deiner Party.`);
      writeJson(PROFILES_JSON, profiles);
      return { ok: false, reason: "no_active" };
    }

    // Vor Verbrauch prüfen: aktives Pokémon bereits auf Lv.100?
    const activeKey = partyMonKey(uid, activeCheck.slot.caughtAt);
    const activeProg = profile.progress?.[activeKey];
    const activeLevel = Math.max(
      1,
      Number(activeProg?.level ?? activeCheck.slot.level ?? 1) || 1
    );

    if (activeLevel >= MAX_LEVEL) {
      if (activeProg) {
        activeProg.level = MAX_LEVEL;
        activeProg.xp = 0;
        activeProg.updatedAt = now();
      }
      activeCheck.slot.level = MAX_LEVEL;
      activeCheck.slot.xp = 0;

      profile.updatedAt = now();
      writeJson(PROFILES_JSON, profiles);
      try { party.cmdParty(uid, uname, "!team"); } catch { }

      writeText(
        itemOutFile(uid),
        `🛑 @${uname} ${activeCheck.slot.displayName || activeCheck.slot.name} ist bereits auf Lv.${MAX_LEVEL}. XP-Bonbons wurden nicht verbraucht.`
      );
      return { ok: false, reason: "already_max_level" };
    }

    const itemDef = ITEM_DEFS[itemId];
    const consume = consumeItem(profile, itemId, amount);
    if (!consume.ok) {
      writeText(itemOutFile(uid), `❌ @${uname} Du hast kein ${itemDef?.emoji || ""} ${itemDef?.label || itemId}.`);
      writeJson(PROFILES_JSON, profiles);
      return { ok: false, reason: "no_item" };
    }

    const totalXpGain = xpPerCandy * amount;
    const res = applyXpToActiveFromCandy(profile, uid, totalXpGain);
    if (!res.ok) {
      // Falls wider Erwarten doch kein aktives Mon da ist: Item zurückgeben
      profile.items[itemId] = Number(profile.items[itemId] || 0) + amount;
      writeJson(PROFILES_JSON, profiles);
      writeText(itemOutFile(uid), `⚠️ @${uname} Kein aktives Pokémon. Item wurde nicht verbraucht.`);
      return { ok: false, reason: "no_active_after_consume" };
    }

    // Level-Evo-Pending prüfen (wie bei chatxp)
    if (res.leveledUp > 0) {
      try {
        // Lazy laden, damit items.js und evo.js sich beim Serverstart nicht
        // gegenseitig als unvollständige Module erhalten.
        require("./evo").checkAndSetPending(profile, uid, res.slot, res.level);
      } catch { }
    }

    profile.updatedAt = now();
    writeJson(PROFILES_JSON, profiles);

    // Party-Overlay sofort aktualisieren
    try { party.cmdParty(uid, uname, "!team"); } catch { }

    // Item-Message (inkl. Restbestand)
    writeText(
      itemOutFile(uid),
      `🍬 @${uname} nutzt ${amount}x ${itemDef.emoji} ${itemDef.label} auf ${res.slot.displayName || res.slot.name} (+${totalXpGain} XP). ` +
      `Lv.${res.level}${res.leveledUp > 0 ? ` | ⬆️ +${res.leveledUp}` : ""} | Rest: ${profile.items[itemId]}`
    );

    log("items.useCandy", {
      uid,
      uname,
      itemId,
      amount,
      xpPerCandy,
      totalXpGain,
      level: res.level,
      leveledUp: res.leveledUp,
      left: profile.items[itemId],
    });

    return { ok: true, itemId, xpGain: totalXpGain, level: res.level, leveledUp: res.leveledUp };
  } catch (e) {
    err("items.use failed", e?.message || String(e));
    return { ok: false, reason: "exception" };
  }
}

module.exports = {
  ITEM_DEFS,
  ITEM_ORDER,
  normalizeItemId,
  handleItems,
  handleGrantItem,
  handleItemUse,   // <-- neu
  hasItem,
  consumeItem,
};
