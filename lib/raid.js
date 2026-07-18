// local/lib/raid.js
const { readJson, writeJson, writeText } = require("./fileStore");
const paths = require("./paths");
const { log, err } = require("./logger");
const { hasActiveSpawn, getActiveSpawn } = require("./eventGuards");

const JOIN_WINDOW_MS = 90_000; // 90s Join-Zeit
const PARTY_SIZE = 6;
const MAX_LEVEL = 100;

// Fallback-Mapping für Raidboss-Bilder (wenn raidBosses.json kein dexId/spriteUrl enthält)
const RAID_BOSS_DEX_FALLBACK = {
  raticate: 20,
  rattikarl: 20,
  arbok: 24,
  golbat: 42,
  kingler: 99,
  onix: 95,
  simsala: 65,
  alakazam: 65,
  dragoran: 149,
  dragonite: 149,
  garados: 130,
  gyarados: 130,
  mewtu: 150,
  mewtwo: 150,
  arktos: 144,
  articuno: 144,
};


const DEFAULT_RAID_STATE = {
  version: 1,
  nextRaidId: 1,
  lastResolvedAt: 0,
  current: null,
};

const DEFAULT_BOSS_CFG = {
  tiers: {
    easy: { requiredTotalLevel: 80, weight: 40 },
    normal: { requiredTotalLevel: 150, weight: 30 },
    hard: { requiredTotalLevel: 260, weight: 18 },
    epic: { requiredTotalLevel: 380, weight: 9 },
    legendary: { requiredTotalLevel: 500, weight: 3 },
  },
  bosses: [
    { id: "raticate_easy", name: "Rattikarl", tier: "easy" },
    { id: "golbat_normal", name: "Golbat", tier: "normal" },
    { id: "onix_hard", name: "Onix", tier: "hard" },
    { id: "dragoran_epic", name: "Dragoran", tier: "epic" },
    { id: "mewtu_legendary", name: "Mewtu", tier: "legendary" },
  ],
};

// Reward-Tables (MVP)
const REWARD_TABLES = {
  easy: [
    { itemId: "xp_candy_s", min: 1, max: 2, chance: 1 },
    { itemId: "xp_candy_m", min: 1, max: 1, chance: 0.15 },
  ],
  normal: [
    { itemId: "xp_candy_s", min: 1, max: 3, chance: 1 },
    { itemId: "xp_candy_m", min: 1, max: 1, chance: 0.45 },
    { itemId: "leaf_stone", min: 1, max: 1, chance: 0.08 },
  ],
  hard: [
    { itemId: "xp_candy_m", min: 1, max: 2, chance: 1 },
    { itemId: "xp_candy_l", min: 1, max: 1, chance: 0.30 },
    { itemId: "fire_stone", min: 1, max: 1, chance: 0.10 },
    { itemId: "water_stone", min: 1, max: 1, chance: 0.10 },
    { itemId: "thunder_stone", min: 1, max: 1, chance: 0.10 },
  ],
  epic: [
    { itemId: "xp_candy_m", min: 1, max: 2, chance: 1 },
    { itemId: "xp_candy_l", min: 1, max: 2, chance: 0.85 },
    { itemId: "fire_stone", min: 1, max: 1, chance: 0.18 },
    { itemId: "water_stone", min: 1, max: 1, chance: 0.18 },
    { itemId: "thunder_stone", min: 1, max: 1, chance: 0.18 },
    { itemId: "leaf_stone", min: 1, max: 1, chance: 0.15 },
    { itemId: "moon_stone", min: 1, max: 1, chance: 0.12 },
  ],
  legendary: [
    { itemId: "xp_candy_l", min: 2, max: 4, chance: 1 },
    { itemId: "xp_candy_m", min: 1, max: 2, chance: 1 },
    { itemId: "fire_stone", min: 1, max: 1, chance: 0.28 },
    { itemId: "water_stone", min: 1, max: 1, chance: 0.28 },
    { itemId: "thunder_stone", min: 1, max: 1, chance: 0.28 },
    { itemId: "leaf_stone", min: 1, max: 1, chance: 0.22 },
    { itemId: "moon_stone", min: 1, max: 1, chance: 0.20 },
  ],
};

const ITEM_LABELS = {
  fire_stone: { label: "Feuerstein", emoji: "🔥" },
  water_stone: { label: "Wasserstein", emoji: "💧" },
  thunder_stone: { label: "Donnerstein", emoji: "⚡" },
  leaf_stone: { label: "Blattstein", emoji: "🌿" },
  moon_stone: { label: "Mondstein", emoji: "🌙" },
  xp_candy_s: { label: "XP-Bonbon S", emoji: "🍬" },
  xp_candy_m: { label: "XP-Bonbon M", emoji: "🍬" },
  xp_candy_l: { label: "XP-Bonbon L", emoji: "🍬" },
};

function now() {
  return Date.now();
}

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function officialArtworkUrl(dexId) {
  const id = Number(dexId || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

function bossLookupKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[_-](easy|normal|hard|epic|legendary)$/i, "")
    .replace(/[^a-z0-9]/g, "");
}

function guessRaidBossDexId(bossBase) {
  const explicit = Number(bossBase?.dexId || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const byId = bossLookupKey(bossBase?.id || "");
  if (byId && RAID_BOSS_DEX_FALLBACK[byId]) return RAID_BOSS_DEX_FALLBACK[byId];

  const byName = bossLookupKey(bossBase?.name || "");
  if (byName && RAID_BOSS_DEX_FALLBACK[byName]) return RAID_BOSS_DEX_FALLBACK[byName];

  return null;
}

function readRaidState() {
  const s = readJson(paths.RAID_STATE_JSON, DEFAULT_RAID_STATE);
  if (!s || typeof s !== "object") return { ...DEFAULT_RAID_STATE };
  s.version ??= 1;
  s.nextRaidId ??= 1;
  s.lastResolvedAt ??= 0;
  if (!("current" in s)) s.current = null;
  return s;
}

function writeRaidState(state) {
  writeJson(paths.RAID_STATE_JSON, state);
}

function writeRaidMessage(text) {
  writeText(paths.RAID_MESSAGE_TXT, String(text ?? ""));
}

function readBossConfig() {
  const cfg = readJson(paths.RAID_BOSSES_JSON, DEFAULT_BOSS_CFG) || DEFAULT_BOSS_CFG;
  cfg.tiers ??= { ...DEFAULT_BOSS_CFG.tiers };
  cfg.bosses = Array.isArray(cfg.bosses) ? cfg.bosses : [...DEFAULT_BOSS_CFG.bosses];
  return cfg;
}

function readProfiles() {
  const base = { version: 1, users: {} };
  const p = readJson(paths.PROFILES_JSON, base);
  if (!p || typeof p !== "object") return base;
  if (!p.users || typeof p.users !== "object") p.users = {};
  if (!p.version) p.version = 1;
  return p;
}

function writeProfiles(p) {
  writeJson(paths.PROFILES_JSON, p);
}

function ensureProfile(profiles, userId, userName) {
  const uid = String(userId || "").trim();
  if (!uid) return null;

  if (!profiles.users[uid]) {
    profiles.users[uid] = {
      id: uid,
      display: String(userName || ""),
      createdAt: now(),
      updatedAt: now(),
      party: { activeSlot: 0, slots: Array.from({ length: PARTY_SIZE }, () => null) },
      progress: {},
      items: {},
      pending: null,
    };
  }

  const u = profiles.users[uid];
  u.display = String(userName || u.display || "");
  u.updatedAt = now();
  u.party ??= { activeSlot: 0, slots: Array.from({ length: PARTY_SIZE }, () => null) };
  u.party.slots ??= Array.from({ length: PARTY_SIZE }, () => null);
  if (u.party.slots.length !== PARTY_SIZE) {
    const old = u.party.slots;
    u.party.slots = Array.from({ length: PARTY_SIZE }, (_, i) => old[i] ?? null);
  }
  u.progress ??= {};
  u.items ??= {};
  return u;
}

function monKey(userId, caughtAt) {
  return `${String(userId)}:${Number(caughtAt) || 0}`;
}

function getActiveSnapshot(profile, userId, userName) {
  if (!profile?.party?.slots) return { ok: false, reason: "no_party" };

  let active = Number(profile.party.activeSlot ?? 0);
  const slots = profile.party.slots;

  if (active < 0 || active >= slots.length || !slots[active]) {
    const first = slots.findIndex(Boolean);
    if (first === -1) return { ok: false, reason: "no_active" };
    profile.party.activeSlot = first;
    active = first;
  }

  const slot = slots[active];
  if (!slot) return { ok: false, reason: "no_active" };

  const key = monKey(userId, slot.caughtAt);
  let level = Math.max(
    1,
    Number(profile.progress?.[key]?.level ?? slot.level ?? 1) || 1
  );

  // Lv.-Cap hart durchsetzen (auch für Altstände >100)
  if (level > MAX_LEVEL) {
    level = MAX_LEVEL;

    profile.progress ??= {};
    profile.progress[key] ??= { xp: 0, level: MAX_LEVEL, createdAt: now(), updatedAt: now() };
    profile.progress[key].level = MAX_LEVEL;
    profile.progress[key].xp = 0;
    profile.progress[key].updatedAt = now();

    slot.level = MAX_LEVEL;
    slot.xp = 0;
  }

  return {
    ok: true,
    userId: String(userId),
    userName: String(userName || profile.display || "User"),
    slotIndex: active,
    caughtAt: Number(slot.caughtAt || 0),
    pokemonName: slot.displayName || slot.name || "???",
    levelSnapshot: level,
    joinedAt: now(),
  };
}

function randomInt(min, max) {
  const a = Math.min(Number(min || 0), Number(max || 0));
  const b = Math.max(Number(min || 0), Number(max || 0));
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

function pickWeighted(entries) {
  const pool = entries
    .map((e) => ({ ...e, weight: Math.max(0, Number(e.weight || 0)) }))
    .filter((e) => e.weight > 0);

  if (!pool.length) return null;

  const sum = pool.reduce((acc, e) => acc + e.weight, 0);
  let r = Math.random() * sum;

  for (const e of pool) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return pool[pool.length - 1];
}

function chooseBoss(cfg, forcedTier = "") {
  const tiers = cfg.tiers || DEFAULT_BOSS_CFG.tiers;
  const bosses = Array.isArray(cfg.bosses) ? cfg.bosses : DEFAULT_BOSS_CFG.bosses;

  let chosenTier = norm(forcedTier);
  if (!chosenTier || !tiers[chosenTier]) {
    const weightedTiers = Object.entries(tiers).map(([tier, def]) => ({
      tier,
      weight: Number(def?.weight ?? 1),
    }));
    const pick = pickWeighted(weightedTiers);
    chosenTier = pick?.tier || "easy";
  }

  const tierDef = tiers[chosenTier] || DEFAULT_BOSS_CFG.tiers.easy;
  const pool = bosses.filter((b) => norm(b.tier) === chosenTier);
  const bossBase = pool.length ? pool[randomInt(0, pool.length - 1)] : { id: `fallback_${chosenTier}`, name: "Raidboss", tier: chosenTier };

  const bossDexId = guessRaidBossDexId(bossBase);
  const bossSpriteUrl =
    String(
      bossBase.spriteUrl ||
      bossBase.artworkUrl ||
      bossBase.imageUrl ||
      officialArtworkUrl(bossDexId) ||
      ""
    ) || null;

  return {
    boss: {
      id: String(bossBase.id || `${chosenTier}_${now()}`),
      name: String(bossBase.name || "Raidboss"),
      tier: chosenTier,
      requiredTotalLevel: Math.max(1, Number(bossBase.requiredTotalLevel ?? tierDef.requiredTotalLevel ?? 80)),
      dexId: bossDexId,
      spriteUrl: bossSpriteUrl,
    },
    tierDef,
  };
}

function sumRaidPower(current) {
  const parts = Object.values(current?.participants || {});
  return parts.reduce((acc, p) => acc + Math.max(1, Number(p?.levelSnapshot || 1)), 0);
}

function timeLeftMs(current) {
  return Math.max(0, Number(current?.joinEndsAt || 0) - now());
}

function formatTimeShort(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${sec}s`;
}

function itemLabel(itemId) {
  const d = ITEM_LABELS[itemId];
  if (!d) return itemId;
  return `${d.emoji} ${d.label}`;
}

function rollRewardsForTier(tier) {
  const table = REWARD_TABLES[norm(tier)] || REWARD_TABLES.easy;
  const result = {};

  for (const entry of table) {
    const chance = entry.chance == null ? 1 : Number(entry.chance);
    if (chance <= 0) continue;
    if (Math.random() > chance) continue;

    const qty = randomInt(entry.min ?? 1, entry.max ?? 1);
    if (qty <= 0) continue;

    result[entry.itemId] = (result[entry.itemId] || 0) + qty;
  }

  return result;
}

function mergeItemMaps(target, source) {
  for (const [itemId, qty] of Object.entries(source || {})) {
    target[itemId] = (target[itemId] || 0) + Number(qty || 0);
  }
  return target;
}

function formatRewardMap(map) {
  const entries = Object.entries(map || {}).filter(([, qty]) => Number(qty) > 0);
  if (!entries.length) return "keine";
  return entries
    .map(([itemId, qty]) => `${itemLabel(itemId)} x${qty}`)
    .join(", ");
}

function statusText(current) {
  if (!current) return "⚔️ Kein aktiver Raid. Warte auf den nächsten Boss!";

  const participants = Object.values(current.participants || {});
  const total = sumRaidPower(current);
  const req = Number(current.boss?.requiredTotalLevel || 0);
  const missing = Math.max(0, req - total);

  const base =
    `🐉 Raid #${current.raidId}: ${current.boss.name} [${String(current.boss.tier).toUpperCase()}] | ` +
    `Ziel: ${req} | Aktuell: ${total}${missing > 0 ? ` (fehlen ${missing})` : " ✅"} | ` +
    `Teilnehmer: ${participants.length}`;

  const tl = timeLeftMs(current);
  if (tl > 0) {
    return `${base} | Join offen: ${formatTimeShort(tl)} | !raid join`;
  }
  return `${base} | Join-Zeit abgelaufen – Auflösung folgt...`;
}

function parseRaidInput(rawInput) {
  const tokens = String(rawInput || "").trim().split(/\s+/).filter(Boolean);
  let idx = 0;

  if (/^!?raid$/i.test(tokens[0] || "")) idx = 1;

  const sub = norm(tokens[idx] || "status");
  const args = tokens.slice(idx + 1);

  return { sub, args };
}

function spawnRaid({ userId = "", userName = "", rawInput = "" } = {}) {
  try {
    const state = readRaidState();
    if (hasActiveSpawn()) {
      const spawn = getActiveSpawn();
      const mon = spawn?.pokemon?.displayName || spawn?.pokemon?.name || "ein Pokémon";
      writeRaidMessage(`⛔ Aktuell ist ein Spawn aktiv (${mon}). Bitte erst fangen/auflösen, dann Raid starten.`);
      return { ok: false, reason: "spawn_active" };
    }

    if (state.current) {
      const text = `⚠️ Es läuft bereits ein Raid. ${statusText(state.current)}`;
      writeRaidMessage(text);
      return { ok: false, reason: "raid_active" };
    }

    const forced = String(rawInput || "")
      .trim()
      .split(/\s+/)
      .map(norm)
      .find((t) => ["easy", "normal", "hard", "epic", "legendary"].includes(t)) || "";

    const cfg = readBossConfig();
    const { boss } = chooseBoss(cfg, forced);

    const raidId = Number(state.nextRaidId || 1);

    state.current = {
      raidId,
      createdAt: now(),
      joinEndsAt: now() + JOIN_WINDOW_MS,
      startedBy: {
        userId: String(userId || ""),
        userName: String(userName || ""),
        source: String(rawInput || ""),
      },
      boss,
      participants: {},
    };
    state.nextRaidId = raidId + 1;

    writeRaidState(state);

    const msg =
      `🐉 Raidboss erschienen: ${boss.name} [${String(boss.tier).toUpperCase()}] | ` +
      `Benötigtes Gesamtlevel: ${boss.requiredTotalLevel} | ` +
      `Join offen für ${Math.ceil(JOIN_WINDOW_MS / 1000)}s mit !raid join`;

    writeRaidMessage(msg);

    log("raid.spawn", {
      raidId,
      boss: boss.name,
      tier: boss.tier,
      req: boss.requiredTotalLevel,
      forced,
    });

    return { ok: true, raidId, boss };
  } catch (e) {
    err("raid.spawn", e?.stack || String(e));
    writeRaidMessage("❌ Raid konnte nicht gestartet werden.");
    return { ok: false, reason: "exception" };
  }
}

function writeRaidStatus() {
  try {
    const state = readRaidState();
    writeRaidMessage(statusText(state.current));
    return { ok: true };
  } catch (e) {
    err("raid.status", e?.stack || String(e));
    writeRaidMessage("❌ Raid-Status konnte nicht geladen werden.");
    return { ok: false, reason: "exception" };
  }
}

function joinRaid({ userId, userName }) {
  const uid = String(userId || "").trim();
  const uname = String(userName || "").trim() || "User";

  if (!uid) {
    writeRaidMessage("❌ Raid-Join fehlgeschlagen: kein User.");
    return { ok: false, reason: "no_user" };
  }

  try {
    const state = readRaidState();
    const current = state.current;

    if (!current) {
      writeRaidMessage("⚔️ Kein aktiver Raid. Warte auf den nächsten Boss!");
      return { ok: false, reason: "no_raid" };
    }

    if (timeLeftMs(current) <= 0) {
      writeRaidMessage(`⏳ Join-Zeit vorbei. ${statusText(current)}`);
      return { ok: false, reason: "join_closed" };
    }

    current.participants ??= {};
    if (current.participants[uid]) {
      const p = current.participants[uid];
      writeRaidMessage(
        `ℹ️ @${uname} ist bereits dabei mit ${p.pokemonName} (Lv.${p.levelSnapshot}). ${statusText(current)}`
      );
      return { ok: false, reason: "already_joined" };
    }

    const profiles = readProfiles();
    const profile = ensureProfile(profiles, uid, uname);

    const snap = getActiveSnapshot(profile, uid, uname);
    if (!snap.ok) {
      writeProfiles(profiles); // falls activeSlot normalisiert wurde / Profil erzeugt wurde
      writeRaidMessage(`⚠️ @${uname} hat kein aktives Pokémon in der Party. Nutze zuerst !team add / !team active.`);
      return { ok: false, reason: snap.reason };
    }

    current.participants[uid] = snap;

    writeProfiles(profiles);
    writeRaidState(state);

    const total = sumRaidPower(current);
    const req = Number(current.boss.requiredTotalLevel || 0);
    const missing = Math.max(0, req - total);

    writeRaidMessage(
      `✅ @${uname} joined den Raid mit ${snap.pokemonName} (Lv.${snap.levelSnapshot}). ` +
      `Power: ${total}/${req}${missing > 0 ? ` (fehlen ${missing})` : " ✅"} | Teilnehmer: ${Object.keys(current.participants).length}`
    );

    log("raid.join", {
      raidId: current.raidId,
      uid,
      uname,
      mon: snap.pokemonName,
      level: snap.levelSnapshot,
    });

    return { ok: true, raidId: current.raidId, total };
  } catch (e) {
    err("raid.join", e?.stack || String(e));
    writeRaidMessage(`❌ @${uname} konnte dem Raid nicht beitreten.`);
    return { ok: false, reason: "exception" };
  }
}

function leaveRaid({ userId, userName }) {
  const uid = String(userId || "").trim();
  const uname = String(userName || "").trim() || "User";

  if (!uid) {
    writeRaidMessage("❌ Raid-Leave fehlgeschlagen: kein User.");
    return { ok: false, reason: "no_user" };
  }

  try {
    const state = readRaidState();
    const current = state.current;

    if (!current) {
      writeRaidMessage("⚔️ Kein aktiver Raid.");
      return { ok: false, reason: "no_raid" };
    }

    current.participants ??= {};
    if (!current.participants[uid]) {
      writeRaidMessage(`ℹ️ @${uname} ist nicht im aktuellen Raid angemeldet. ${statusText(current)}`);
      return { ok: false, reason: "not_joined" };
    }

    delete current.participants[uid];
    writeRaidState(state);

    writeRaidMessage(`↩️ @${uname} hat den Raid verlassen. ${statusText(current)}`);
    log("raid.leave", { raidId: current.raidId, uid, uname });

    return { ok: true };
  } catch (e) {
    err("raid.leave", e?.stack || String(e));
    writeRaidMessage(`❌ @${uname} konnte den Raid nicht verlassen.`);
    return { ok: false, reason: "exception" };
  }
}

function grantRewardsToParticipants(current) {
  const participants = Object.values(current?.participants || {});
  const profiles = readProfiles();

  const perUserRewards = {};
  const aggregate = {};

  for (const p of participants) {
    const uid = String(p.userId || "").trim();
    if (!uid) continue;

    const profile = ensureProfile(profiles, uid, p.userName || "");
    profile.items ??= {};

    const rewardMap = rollRewardsForTier(current.boss.tier);

    // Falls RNG alles "wegwürfelt", gib wenigstens 1x XP-Bonbon S als Trost (nur Sieg-Fall)
    if (!Object.keys(rewardMap).length) {
      rewardMap.xp_candy_s = 1;
    }

    mergeItemMaps(profile.items, rewardMap);
    perUserRewards[uid] = rewardMap;
    mergeItemMaps(aggregate, rewardMap);
  }

  writeProfiles(profiles);
  return { perUserRewards, aggregate };
}

function resolveRaid({ force = false } = {}) {
  try {
    const state = readRaidState();
    const current = state.current;

    if (!current) {
      writeRaidMessage("⚔️ Kein aktiver Raid zum Auflösen.");
      return { ok: false, reason: "no_raid" };
    }

    const left = timeLeftMs(current);
    if (!force && left > 0) {
      writeRaidMessage(`⏳ Raid noch offen (${formatTimeShort(left)}). ${statusText(current)}`);
      return { ok: false, reason: "too_early", msLeft: left };
    }

    const participants = Object.values(current.participants || {});
    const total = sumRaidPower(current);
    const req = Number(current.boss.requiredTotalLevel || 0);

    if (!participants.length) {
      state.current = null;
      state.lastResolvedAt = now();
      writeRaidState(state);

      writeRaidMessage(
        `😶 Raid #${current.raidId} gegen ${current.boss.name} [${String(current.boss.tier).toUpperCase()}] endet ohne Teilnehmer.`
      );

      log("raid.resolve.noParticipants", { raidId: current.raidId });
      return { ok: true, noParticipants: true };
    }

    const win = total >= req;

    let rewardResult = null;
    if (win) {
      rewardResult = grantRewardsToParticipants(current);
    }

    const partShort = participants
      .slice(0, 6)
      .map((p) => `@${p.userName}(${p.pokemonName} Lv.${p.levelSnapshot})`)
      .join(", ");

    let msg =
      `${win ? "✅" : "❌"} Raid #${current.raidId} ${win ? "geschafft" : "gescheitert"} gegen ${current.boss.name} ` +
      `[${String(current.boss.tier).toUpperCase()}] | Power ${total}/${req} | ` +
      `Teilnehmer: ${participants.length}` +
      (partShort ? ` | ${partShort}${participants.length > 6 ? " ..." : ""}` : "");

    if (win && rewardResult) {
      const rewardPreview = participants
        .slice(0, 4)
        .map((p) => {
          const rm = rewardResult.perUserRewards[p.userId] || {};
          return `@${p.userName}: ${formatRewardMap(rm)}`;
        })
        .join(" | ");

      msg += ` | 🎁 Rewards verteilt` + (rewardPreview ? ` | ${rewardPreview}` : "");
    }

    state.current = null;
    state.lastResolvedAt = now();
    writeRaidState(state);
    writeRaidMessage(msg);

    log("raid.resolve", {
      raidId: current.raidId,
      boss: current.boss.name,
      tier: current.boss.tier,
      total,
      req,
      participants: participants.length,
      win,
    });

    return { ok: true, win, total, req, participants: participants.length };
  } catch (e) {
    err("raid.resolve", e?.stack || String(e));
    writeRaidMessage("❌ Raid-Auflösung fehlgeschlagen.");
    return { ok: false, reason: "exception" };
  }
}

function handleRaid({ userId = "", userName = "", rawInput = "" } = {}) {
  try {
    const { sub } = parseRaidInput(rawInput);

    if (!sub || sub === "status" || sub === "info") {
      return writeRaidStatus();
    }

    if (sub === "join") {
      return joinRaid({ userId, userName });
    }

    if (sub === "leave") {
      return leaveRaid({ userId, userName });
    }

    if (sub === "help") {
      writeRaidMessage("ℹ️ Raid-Befehle: !raid | !raid join | !raid leave");
      return { ok: true };
    }

    // Komfort: !raid -> status, !raid irgendwas -> status/help
    writeRaidMessage("ℹ️ Raid-Befehle: !raid | !raid join | !raid leave");
    return { ok: true, help: true };
  } catch (e) {
    err("raid.handle", e?.stack || String(e));
    writeRaidMessage("❌ Raid-Fehler.");
    return { ok: false, reason: "exception" };
  }
}

function writeRaidOverlayState(patch = {}) {
  const base = store.readJson(paths.RAID_STATE_JSON, {}) || {};
  const next = {
    ...base,
    ...patch,
    updatedAt: Date.now()
  };
  store.writeJson(paths.RAID_STATE_JSON, next);
  return next;
}

module.exports = {
  handleRaid,
  spawnRaid,
  resolveRaid,
  writeRaidStatus,
};