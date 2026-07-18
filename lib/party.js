// local/lib/party.js
// Team management for the PokéDex Twitch game.
// Commands (handled via poke.js dispatcher):
//   !team
//   !team add <pokemonName>
//   !team remove <slot|pokemonName>
//   !team pick <number>
// Notes:
// - We do NOT mutate pokedex.json (caught list). Team references caughtAt + name.
// - XP/Level live in profiles.json (so we can change later without rewriting pokedex).

const path = require('path');

// Expect these helper modules in local/lib/ (matching your current project structure)
const { readJson, writeJson, writeText, ensureDirs } = require('./fileStore');
const { POKEDEX_JSON, PROFILES_JSON, OUT_DIR } = require('./paths');
const logger = require('./logger');

const PARTY_SIZE = 6;
const PENDING_TTL_MS = 2 * 60_000;

function now() { return Date.now(); }

function normName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\-\s]/gi, '')
    .replace(/\s+/g, ' ');
}

function outFileFor(userId) {
  ensureDirs(OUT_DIR);
  return path.join(OUT_DIR, `partyMessage_${userId}.txt`);
}

function ensureProfiles() {
  const base = { version: 1, users: {} };
  const p = readJson(PROFILES_JSON, base);
  if (!p || typeof p !== 'object') return base;
  if (!p.users) p.users = {};
  if (!p.version) p.version = 1;
  return p;
}

function ensureUserProfile(profiles, userId, display) {
  if (!profiles.users[userId]) {
    profiles.users[userId] = {
      id: String(userId),
      display: String(display || ''),
      createdAt: now(),
      updatedAt: now(),
      // party holds references to caught mons (by caughtAt + name)
      party: {
        activeSlot: 0,
        slots: Array.from({ length: PARTY_SIZE }, () => null),
      },
      // per-mon progress keyed by monKey = `${userId}:${caughtAt}`
      progress: {},
      pending: null,
    };
  } else {
    profiles.users[userId].display = String(display || profiles.users[userId].display || '');
    profiles.users[userId].updatedAt = now();
    profiles.users[userId].party ??= { activeSlot: 0, slots: Array.from({ length: PARTY_SIZE }, () => null) };
    profiles.users[userId].party.slots ??= Array.from({ length: PARTY_SIZE }, () => null);
    // normalize length
    if (profiles.users[userId].party.slots.length !== PARTY_SIZE) {
      const old = profiles.users[userId].party.slots;
      profiles.users[userId].party.slots = Array.from({ length: PARTY_SIZE }, (_, i) => old[i] ?? null);
    }
    profiles.users[userId].progress ??= {};
  }
  return profiles.users[userId];
}

function getPokedex() {
  const base = { users: {} };
  const p = readJson(POKEDEX_JSON, base);
  if (!p || typeof p !== 'object') return base;
  if (!p.users) p.users = {};
  return p;
}

function findUserCaught(pokedex, userId) {
  const u = pokedex.users?.[userId];
  return Array.isArray(u?.caught) ? u.caught : [];
}

function syncPartyWithPokedex(profile, pokedex, userId) {
  const owned = new Set(
    findUserCaught(pokedex, userId)
      .map(m => Number(m?.caughtAt || 0))
      .filter(Boolean)
  );

  let changed = false;

  profile.party ??= { activeSlot: 0, slots: Array.from({ length: PARTY_SIZE }, () => null) };
  profile.party.slots ??= Array.from({ length: PARTY_SIZE }, () => null);

  for (let i = 0; i < profile.party.slots.length; i++) {
    const s = profile.party.slots[i];
    if (!s) continue;

    const ts = Number(s.caughtAt || 0);
    if (!ts || !owned.has(ts)) {
      profile.party.slots[i] = null;
      changed = true;
      if ((profile.party.activeSlot ?? 0) === i) profile.party.activeSlot = 0;
    }
  }

  // activeSlot auf ein existierendes Pokémon zeigen lassen
  const a = Number(profile.party.activeSlot ?? 0);
  if (a < 0 || a >= PARTY_SIZE || !profile.party.slots[a]) {
    const first = profile.party.slots.findIndex(Boolean);
    profile.party.activeSlot = first === -1 ? 0 : first;
    changed = true;
  }

  return changed;
}


function monKey(userId, caughtAt) {
  return `${userId}:${Number(caughtAt) || 0}`;
}

function ensureProgress(profile, userId, mon) {
  const key = monKey(userId, mon.caughtAt);
  if (!profile.progress[key]) {
    profile.progress[key] = { xp: 0, level: 1, createdAt: now(), updatedAt: now() };
  }
  return profile.progress[key];
}

function formatCaughtAt(ts) {
  const t = Number(ts) || 0;
  if (!t) return 'unbekannt';
  const d = new Date(t);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
}

function describeMonForList(mon, prog) {
  const shiny = mon.isShiny ? '✨ ' : '';
  const rarity = mon.rarity ? ` (${String(mon.rarity).toUpperCase()})` : '';
  const lvl = prog?.level ?? 1;
  return `${shiny}${mon.displayName || mon.name}${rarity} — Lv.${lvl} — gefangen: ${formatCaughtAt(mon.caughtAt)}`;
}

function partySummary(profile) {
  const slots = profile.party?.slots || [];
  const active = Number(profile.party?.activeSlot ?? 0);

  const lines = slots
    .map((s, i) => ({ s, i }))
    .filter(x => x.s) // nur belegte Slots anzeigen
    .map(({ s, i }) => {
      const prefix = i === active ? '⭐' : '  ';
      const shiny = s.isShiny ? '✨ ' : '';
      const lvl = s.level ?? 1;
      return `${prefix} ${i + 1}: ${shiny}${s.displayName || s.name} Lv.${lvl}`;
    });

  let text = lines.length ? lines.join(' | ') : '(leeres Team)';

  if (profile.evoPending) {
    const e = profile.evoPending;
    text += ` | 🧬 Evo: ${e.fromName} → ${e.toName} (ab Lv.${e.atLevel}) — !evo yes / !evo no`;
  }

  return text;
}



function clearExpiredPending(profile) {
  if (!profile.pending) return;
  if ((profile.pending.expiresAt || 0) < now()) profile.pending = null;
}

function setPending(profile, pending) {
  profile.pending = { ...pending, createdAt: now(), expiresAt: now() + PENDING_TTL_MS };
}

function nextEmptySlot(profile) {
  const slots = profile.party.slots;
  for (let i = 0; i < slots.length; i++) if (!slots[i]) return i;
  return -1;
}

function isAlreadyInParty(profile, userId, mon) {
  const key = monKey(userId, mon.caughtAt);
  return profile.party.slots.some(s => s && s.monKey === key);
}

function buildPartySlotEntry(userId, mon, prog) {
  return {
    monKey: monKey(userId, mon.caughtAt),
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

function resolvePartySlotRef(profile, refRaw) {
  const ref = String(refRaw || '').trim();
  if (!ref) return { ok: false, reason: 'empty' };

  // 1) Slot-Nummer (1-6)
  const n = Number(ref);
  if (Number.isFinite(n) && n >= 1 && n <= PARTY_SIZE) {
    const idx = n - 1;
    if (!profile.party.slots[idx]) return { ok: false, reason: 'slot_empty', idx };
    return { ok: true, idx, by: 'slot' };
  }

  // 2) Pokémon-Name in der Party (exakt normalisiert)
  const name = normName(ref);
  const matches = profile.party.slots
    .map((s, i) => ({ s, i }))
    .filter(x => x.s && (normName(x.s.displayName || x.s.name) === name));

  if (!matches.length) return { ok: false, reason: 'not_found' };
  if (matches.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      options: matches.map(m => m.i + 1), // Slotnummern anzeigen
    };
  }

  return { ok: true, idx: matches[0].i, by: 'name' };
}

function cmdParty(userId, display, rawInput) {
  const outFile = outFileFor(userId);
  try {
    const pokedex = getPokedex();
    const profiles = ensureProfiles();
    const profile = ensureUserProfile(profiles, userId, display);
    clearExpiredPending(profile);

    const changed = syncPartyWithPokedex(profile, pokedex, userId);
    if (changed) writeJson(PROFILES_JSON, profiles);


    const args = String(rawInput || '').trim().split(/\s+/).filter(Boolean);
    // args[0] is !team
    const sub = (args[1] || '').toLowerCase();

    if (!sub) {
      writeJson(PROFILES_JSON, profiles);
      return writeText(outFile, `👥@${display}'s Team: ${partySummary(profile)} | Befehle: !team add/remove <Mon> | !team swap <A> <B> | !team active <Nr>`);
    }

    if (sub === 'pick') {
      const n = Number(args[2]);
      if (!n || n < 1) return writeText(outFile, `❌ Nutzung: !team pick <Nummer>`);
      if (!profile.pending) return writeText(outFile, `❌ Kein offenes Menü. Nutze erst !team add/remove ...`);

      const idx = n - 1;
      const opt = profile.pending.options?.[idx];
      if (!opt) return writeText(outFile, `❌ Ungültige Auswahl. Nummern: 1-${profile.pending.options?.length || 0}`);

      const caught = findUserCaught(pokedex, userId);
      const mon = caught.find(m => Number(m?.caughtAt) === Number(opt.caughtAt));
      if (!mon) {
        profile.pending = null;
        writeJson(PROFILES_JSON, profiles);
        return writeText(outFile, `❌ Dieses Pokémon existiert nicht mehr (wurde evtl. getauscht).`);
      }

      if (profile.pending.type === 'add') {
        const slot = nextEmptySlot(profile);
        if (slot === -1) {
          profile.pending = null;
          writeJson(PROFILES_JSON, profiles);
          return writeText(outFile, `❌ Dein Team ist voll (6/6). Entferne erst eins: !team remove <Slot|Mon>`);
        }
        if (isAlreadyInParty(profile, userId, mon)) {
          profile.pending = null;
          writeJson(PROFILES_JSON, profiles);
          return writeText(outFile, `⚠️ ${mon.displayName || mon.name} ist bereits in deinem Team.`);
        }
        const prog = ensureProgress(profile, userId, mon);
        profile.party.slots[slot] = buildPartySlotEntry(userId, mon, prog);
        profile.pending = null;
        writeJson(PROFILES_JSON, profiles);
        return writeText(outFile, `✅ ${mon.displayName || mon.name} wurde zu Slot ${slot + 1} hinzugefügt. ${partySummary(profile)}`);
      }

      if (profile.pending.type === 'remove') {
        // remove by monKey
        const key = monKey(userId, mon.caughtAt);
        const slotIndex = profile.party.slots.findIndex(s => s && s.monKey === key);
        if (slotIndex === -1) {
          profile.pending = null;
          writeJson(PROFILES_JSON, profiles);
          return writeText(outFile, `❌ Dieses Pokémon ist nicht in deiner Party.`);
        }
        profile.party.slots[slotIndex] = null;
        if ((profile.party.activeSlot ?? 0) === slotIndex) profile.party.activeSlot = 0;
        profile.pending = null;
        writeJson(PROFILES_JSON, profiles);
        return writeText(outFile, `🗑️ Entfernt aus Slot ${slotIndex + 1}. ${partySummary(profile)}`);
      }

      profile.pending = null;
      writeJson(PROFILES_JSON, profiles);
      return writeText(outFile, `❌ Unbekannter Pending-Typ.`);
    }

    if (sub === 'add') {
      const name = normName(args.slice(2).join(' '));
      if (!name) return writeText(outFile, `❌ Nutzung: !team add <PokemonName>`);

      const slot = nextEmptySlot(profile);
      if (slot === -1) return writeText(outFile, `❌ Dein Team ist voll (6/6). Entferne erst eins: !team remove <Slot|Mon>`);

      const caught = findUserCaught(pokedex, userId);
      const matches = caught
        .filter(m => normName(m?.name || m?.displayName) === name)
        .sort((a, b) => Number(b?.caughtAt || 0) - Number(a?.caughtAt || 0));

      if (!matches.length) return writeText(outFile, `❌ Du besitzt kein "${args.slice(2).join(' ')}".`);

      if (matches.length === 1) {
        const mon = matches[0];
        if (isAlreadyInParty(profile, userId, mon)) return writeText(outFile, `⚠️ ${mon.displayName || mon.name} ist bereits in deinem Team.`);
        const prog = ensureProgress(profile, userId, mon);
        profile.party.slots[slot] = buildPartySlotEntry(userId, mon, prog);
        writeJson(PROFILES_JSON, profiles);
        return writeText(outFile, `✅ ${mon.displayName || mon.name} wurde zu Slot ${slot + 1} hinzugefügt. ${partySummary(profile)}`);
      }

      // multiple → menu
      const options = matches.slice(0, 10).map(m => ({ caughtAt: m.caughtAt }));
      setPending(profile, { type: 'add', options });
      writeJson(PROFILES_JSON, profiles);

      const lines = options.map((o, i) => {
        const mon = matches.find(m => Number(m.caughtAt) === Number(o.caughtAt));
        const prog = ensureProgress(profile, userId, mon);
        return `${i + 1}) ${describeMonForList(mon, prog)}`;
      });
      return writeText(outFile, `📋 Mehrere gefunden. Wähle mit: !team pick <Nummer> | ${lines.join(' | ')}`);
    }

    if (sub === 'active') {
      const raw = String(args[2] || '').trim();
      const n = Number(raw);

      if (!Number.isFinite(n) || n < 1 || n > PARTY_SIZE) {
        return writeText(outFile, `❌ Nutzung: !team active <1-${PARTY_SIZE}>`);
      }

      const idx = n - 1;
      const slot = profile.party.slots[idx];

      if (!slot) {
        return writeText(outFile, `❌ Slot ${n} ist leer.`);
      }

      profile.party.activeSlot = idx;
      writeJson(PROFILES_JSON, profiles);

      return writeText(
        outFile,
        `⭐ Aktives Pokémon ist jetzt ${slot.displayName || slot.name}.`
      );
    }

    if (sub === 'swap') {
      const left = String(args[2] || '').trim();
      const right = String(args[3] || '').trim();

      if (!left || !right) {
        return writeText(outFile, `❌ Nutzung: !team swap <Slot|PokemonName> <Slot|PokemonName>`);
      }

      const a = resolvePartySlotRef(profile, left);
      if (!a.ok) {
        if (a.reason === 'slot_empty') return writeText(outFile, `❌ Slot ${a.idx + 1} ist leer.`);
        if (a.reason === 'ambiguous') return writeText(outFile, `❌ "${left}" ist mehrfach in deinem Team (Slots: ${a.options.join(', ')}). Nutze Slotnummern.`);
        return writeText(outFile, `❌ "${left}" wurde in deinem Team nicht gefunden.`);
      }

      const b = resolvePartySlotRef(profile, right);
      if (!b.ok) {
        if (b.reason === 'slot_empty') return writeText(outFile, `❌ Slot ${b.idx + 1} ist leer.`);
        if (b.reason === 'ambiguous') return writeText(outFile, `❌ "${right}" ist mehrfach in deinem Team (Slots: ${b.options.join(', ')}). Nutze Slotnummern.`);
        return writeText(outFile, `❌ "${right}" wurde in deinem Team nicht gefunden.`);
      }

      if (a.idx === b.idx) {
        return writeText(outFile, `ℹ️ Beide Angaben zeigen auf Slot ${a.idx + 1}. Nichts zu tauschen.`);
      }

      // Swap slots
      const tmp = profile.party.slots[a.idx];
      profile.party.slots[a.idx] = profile.party.slots[b.idx];
      profile.party.slots[b.idx] = tmp;

      // Active slot (⭐) mitwandern lassen
      const active = Number(profile.party.activeSlot ?? 0);
      if (active === a.idx) profile.party.activeSlot = b.idx;
      else if (active === b.idx) profile.party.activeSlot = a.idx;

      writeJson(PROFILES_JSON, profiles);

      return writeText(
        outFile,
        `🔀 Slots ${a.idx + 1} und ${b.idx + 1} getauscht. ${partySummary(profile)}`
      );
    }

    if (sub === 'remove') {
      const rest = args.slice(2).join(' ').trim();
      if (!rest) return writeText(outFile, `❌ Nutzung: !team remove <Slot(1-6)|PokemonName>`);

      // remove by slot
      const n = Number(rest);
      if (n && n >= 1 && n <= PARTY_SIZE) {
        const slotIndex = n - 1;
        if (!profile.party.slots[slotIndex]) return writeText(outFile, `❌ Slot ${n} ist bereits leer.`);
        profile.party.slots[slotIndex] = null;
        if ((profile.party.activeSlot ?? 0) === slotIndex) profile.party.activeSlot = 0;
        writeJson(PROFILES_JSON, profiles);
        return writeText(outFile, `🗑️ Slot ${n} geleert. ${partySummary(profile)}`);
      }

      // remove by name (might be duplicates in party)
      const name = normName(rest);
      const inParty = profile.party.slots
        .map((s, i) => ({ s, i }))
        .filter(x => x.s && normName(x.s.name || x.s.displayName) === name);

      if (!inParty.length) return writeText(outFile, `❌ "${rest}" ist nicht in deiner Party.`);
      if (inParty.length === 1) {
        const slotIndex = inParty[0].i;
        profile.party.slots[slotIndex] = null;
        if ((profile.party.activeSlot ?? 0) === slotIndex) profile.party.activeSlot = 0;
        writeJson(PROFILES_JSON, profiles);
        return writeText(outFile, `🗑️ Entfernt aus Slot ${slotIndex + 1}. ${partySummary(profile)}`);
      }

      // ambiguous → menu via caughtAt lookup
      const pokedex = getPokedex();
      const caught = findUserCaught(pokedex, userId);
      const options = inParty
        .slice(0, 10)
        .map(x => ({ caughtAt: x.s.caughtAt }));
      setPending(profile, { type: 'remove', options });
      writeJson(PROFILES_JSON, profiles);

      const lines = options.map((o, i) => {
        const mon = caught.find(m => Number(m?.caughtAt) === Number(o.caughtAt)) || { ...inParty[i].s };
        const prog = profile.progress[monKey(userId, o.caughtAt)] || { level: inParty[i].s.level ?? 1 };
        return `${i + 1}) ${describeMonForList(mon, prog)}`;
      });
      return writeText(outFile, `📋 Mehrere in deinem Team. Wähle mit: !team pick <Nummer> | ${lines.join(' | ')}`);
    }

    writeJson(PROFILES_JSON, profiles);
    return writeText(outFile, `❌ Unbekannter Team-Befehl. Nutze: !team | !team add | !team remove | !team pick`);
  } catch (e) {
    logger.err('team', e);
    return writeText(outFileFor(userId), `❌ Team-Fehler: ${e?.message || e}`);
  }
}

module.exports = { cmdParty, outFileFor };
