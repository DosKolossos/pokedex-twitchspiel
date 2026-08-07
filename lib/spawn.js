const { ensureDirs, readJson, writeJson, writeText } = require('./fileStore');
const { log } = require('./logger');
const paths = require("./paths");
const { hasActiveRaid, getActiveRaid } = require('./eventGuards');
const {
  SPAWN_JSON,
  SPAWN_MESSAGE_TXT,
  // IMPORTANT: add this to paths.js (see notes below)
  DEXMAP_JSON,
} = require('./paths');

// ----------------------
// Dexmap loading (cached)
// ----------------------
let DEXMAP_CACHE = null;



function loadDexmap() {
  if (DEXMAP_CACHE) return DEXMAP_CACHE;

  // Supports either:
  // 1) { byName: { "schiggy": { dexId, spriteUrl } } }
  // 2) { "schiggy": { dexId, spriteUrl } }
  // 3) { "schiggy": 7 }
  const raw = readJson(DEXMAP_JSON, null);
  const byName = raw?.byName && typeof raw.byName === 'object' ? raw.byName : raw;

  DEXMAP_CACHE = byName && typeof byName === 'object' ? byName : {};
  return DEXMAP_CACHE;
}

function normName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[’'`]/g, "'");
}

function dexEntryFor(name) {
  const map = loadDexmap();
  const key = normName(name);

  // Nidoran variants that people tend to type
  // NOTE: normName() keeps single spaces (e.g. "nidoran w"), so we handle both spaced and unspaced variants.
  if (key === 'nidoran' || key === 'nidoranm' || key === 'nidoran m' || key === 'nidoran♂') {
    return map['nidoran♂'] || map['nidoranm'] || { dexId: 32, name: 'Nidoran♂', displayName: 'Nidoran♂' };
  }

  if (key === 'nidoranw' || key === 'nidoranf' || key === 'nidoran w' || key === 'nidoran f' || key === 'nidoran♀') {
    return map['nidoran♀'] || map['nidoranw'] || map['nidoranf'] || { dexId: 29, name: 'Nidoran♀', displayName: 'Nidoran♀' };
  }

  return map[key] || map[key.replace(/[^a-z0-9♀♂ ]/g, '')] || null;
}

function toDexId(entry) {
  if (entry == null) return null;
  if (typeof entry === 'number') return entry;
  if (typeof entry === 'string' && /^\d+$/.test(entry)) return Number(entry);
  if (typeof entry === 'object' && entry.dexId != null) return Number(entry.dexId);
  return null;
}

function officialArtworkUrl(dexId) {
  return dexId
    ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexId}.png`
    : null;
}

// ----------------------
// RNG helpers
// ----------------------
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted(list) {
  const sum = list.reduce((a, b) => a + b.w, 0);
  let r = Math.random() * sum;
  for (const it of list) {
    r -= it.w;
    if (r <= 0) return it.v;
  }
  return list[list.length - 1].v;
}

// ----------------------
// Pools / Rarity
// (copy from your current poke.js)
// ----------------------
const RARITY_ALIASES = {
  c: 'common',
  common: 'common',
  u: 'uncommon',
  uncommon: 'uncommon',
  r: 'rare',
  rare: 'rare',
  e: 'epic',
  epic: 'epic',
  l: 'legendary',
  legendary: 'legendary',
  g: 'gottheit',
  gottheit: 'gottheit',
};


const POOLS = {
  common: [
    'Rattfratz', 'Taubsi', 'Raupy', 'Hornliu', 'Habitak', 'Safcon', 'Kokuna', 'Myrapla', 'Paras', 'Digda',
    'Quapsel', 'Knofensa', 'Tentacha', 'Kleinstein', 'Ponita', 'Dodu', 'Jurob', 'Sleima', 'Muschas', 'Krabby',
    'Tragosso', 'Smogon', 'Goldini', 'Sterndu', 'Karpador', 'Zubat', 'Nebulak', 'Rettan', 'Sandan', 'Nidoran♀', 'Nidoran♂',
    'Menki', 'Owei', 'Flegmon', 'Enton', 'Bluzuk', 'Voltobal', 'Fukano', 'Abra', 'Machollo', 'Mauzi'
  ],
  uncommon: [
    'Piepi', 'Vulpix', 'Pummeluff', 'Duflor', 'Parasek', 'Tentoxa', 'Georok', 'Gallopa', 'Lahmus', 'Magnetilo',
    'Porenta', 'Dodri', 'Jugong', 'Sleimok', 'Austos', 'Nidorino', 'Nidorina', 'Traumato', 'Hypno', 'Kingler',
    'Lektrobal', 'Kokowei', 'Knogga', 'Smogmog', 'Rihorn', 'Seemon', 'Golking', 'Golbat', 'Sandamer', 'Rasaff',
    'Maschock', 'Quaputzi', 'Alpollo', 'Bisasam', 'Glumanda', 'Arbok', 'Pikachu', 'Onix', 'Ultrigaria',
    'Omot', 'Kadabra', 'Evoli', 'Digdri', 'Snobilikat', 'Entoron'
  ],
  rare: [
    'Bisaknosp', 'Glutexo', 'Schillok', 'Raichu', 'Nidoqueen', 'Nidoking', 'Pixi', 'Vulnona', 'Knuddeluff', 'Giflor',
    'Quappo', 'Sarzenia', 'Geowaz', 'Magneton', 'Pantimos', 'Tauros', 'Amonitas', 'Amoroso', 'Kabuto', 'Kabutops',
    'Kicklee', 'Nockchan', 'Chaneira', 'Kangama', 'Ditto', 'Starmie', 'Sichlor', 'Rossana', 'Elektek', 'Magmar',
    'Pinsir', 'Aquana', 'Blitza', 'Flamara', 'Porygon', 'Tauboss', 'Dratini', 'Dragonir', 'Rizeros', 'Arkani'
  ],
  epic: ['Relaxo', 'Aerodactyl', 'Garados', 'Bisaflor', 'Turtok', 'Lapras', 'Simsala', 'Machomei', 'Gengar', 'Dragoran'],
  legendary: ['Arktos', 'Zapdos', 'Lavados', 'Mewtu', 'Mew', 'Schiggy'],
  gottheit: ['Glurak'],
};

function parseSpawnArgs(rawInput) {
  const tokens = String(rawInput || '').trim().split(/\s+/).filter(Boolean);
  const t1 = tokens[1] ? normName(tokens[1]) : null;
  const rest = tokens.length > 2 ? tokens.slice(2).join(' ') : null;

  let forcedRarity = null;
  let forcedPokemon = null;

  if (t1 && RARITY_ALIASES[t1]) {
    forcedRarity = RARITY_ALIASES[t1];
    if (rest) forcedPokemon = rest;
  } else if (tokens.length > 1) {
    forcedPokemon = tokens.slice(1).join(' ');
  }

  return { forcedRarity, forcedPokemon };
}

function rollPokemon(forcedRarity = null) {
  const rarity = forcedRarity || pickWeighted([
    { v: 'common', w: 60 },
    { v: 'uncommon', w: 25 },
    { v: 'rare', w: 10 },
    { v: 'epic', w: 3.5 },
    { v: 'legendary', w: 1.2 },
    { v: 'gottheit', w: 0.3 },
  ]);

  const name = pick(POOLS[rarity] || POOLS.common);
  const isShiny = Math.random() < 1 / 256;

  const entry = dexEntryFor(name);
  const dexId = toDexId(entry);
  const spriteUrl = (typeof entry === 'object' && entry?.spriteUrl) ? entry.spriteUrl : officialArtworkUrl(dexId);

  const displayName = `${isShiny ? '✨ Shiny ' : ''}${name}`;
  return { name, displayName, rarity, isShiny, form: null, dexId, spriteUrl };
}

function canonicalName(input) {
  const key = normName(input);

  // 1) Wenn im Pool vorhanden: nimm die Original-Schreibweise aus POOLS
  for (const r of Object.keys(POOLS)) {
    const found = (POOLS[r] || []).find(n => normName(n) === key);
    if (found) return found;
  }

  // 2) Fallback: erster Buchstabe groß, Rest klein (behält ♀/♂ etc.)
  const s = String(input || '').trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function blockIfActive(state, mode, rawInput) {
  const active = !!state.active && (state.endsAt || 0) > Date.now();
  if (!active) return false;

  const p = state.pokemon?.displayName || state.pokemon?.name || '???';
  writeText(SPAWN_MESSAGE_TXT, `⚠️ Es läuft bereits ein Spawn: ${p} – nutze !catch!`);
  log(`spawn blocked (${mode}) pokemon=${p} endsAt=${state.endsAt} raw=${rawInput ? JSON.stringify(rawInput) : ''}`);
  return true;
}

function blockIfRaidActive(mode, rawInput) {
  if (!hasActiveRaid()) return false;

  const raid = getActiveRaid();
  const boss = raid?.boss?.name || 'Raidboss';

  // Für Auto-Spawn lieber still abbrechen (kein Chat-Spam)
  if (mode === 'auto') {
    log(`spawn blocked (raid active) mode=${mode} boss=${boss}`);
    return true;
  }

  // Für manuellen Spawn Hinweis ausgeben
  writeText(SPAWN_MESSAGE_TXT, `⛔ Während eines aktiven Raids (${boss}) erscheinen keine normalen Spawns.`);
  log(`spawn blocked (raid active) mode=${mode} boss=${boss} raw=${rawInput ? JSON.stringify(rawInput) : ''}`);
  return true;
}

function startSpawn(pokemon, mode, rawInput) {
  if (hasActiveRaid()) {
    // Für Auto-Spawn-Timer lieber still abbrechen oder nur loggen:
    // return { ok: false, reason: "raid_active" };

    // Wenn du Chat-Feedback willst (z.B. bei manuellem !spawn):
    writeText(SPAWN_MESSAGE_TXT, "⛔ Während eines aktiven Raids erscheinen keine normalen Spawns.");
    return { ok: false, reason: "raid_active" };
  }
  const next = {
    active: true,
    pokemon,
    endsAt: Date.now() + 60_000,
    participants: [],
  };

  writeJson(SPAWN_JSON, next);
  writeText(
    SPAWN_MESSAGE_TXT,
    `Ein wildes ${pokemon.displayName} (${String(pokemon.rarity || '').toUpperCase()}) taucht auf! 🔴⚪ Nutze !catch – du hast 60 Sekunden!`
  );
  log(`spawn ok (${mode}) name=${pokemon.name} rarity=${pokemon.rarity} dexId=${pokemon.dexId} raw=${rawInput ? JSON.stringify(rawInput) : ''}`);
  return { ok: true, pokemon };
}

function prepareAuto() {
  ensureDirs();
  if (blockIfRaidActive('auto', null)) return { ok: false, reason: 'raid_active' };
  const state = readJson(SPAWN_JSON, { active: false, pokemon: null, endsAt: 0, participants: [] });
  if (blockIfActive(state, 'auto', null)) return { ok: false, reason: 'active' };
  return { ok: true, pokemon: rollPokemon(null), mode: 'auto', rawInput: null };
}

function spawnAuto() {
  const prepared = prepareAuto();
  return prepared.ok ? startSpawn(prepared.pokemon, prepared.mode, prepared.rawInput) : prepared;
}

function prepareManual(rawInput) {
  ensureDirs();
  if (blockIfRaidActive('manual', rawInput)) return { ok: false, reason: 'raid_active' };
  const state = readJson(SPAWN_JSON, { active: false, pokemon: null, endsAt: 0, participants: [] });
  if (blockIfActive(state, 'manual', rawInput)) return { ok: false, reason: 'active' };

  const { forcedRarity, forcedPokemon } = parseSpawnArgs(rawInput);

  // Nidoran gender hint: allow "!spawn Nidoran w/f" and "!spawn Nidoran m"
  let nidoranGenderHint = null; // 'male' | 'female' | null
  if (forcedPokemon) {
    const fpRaw = String(forcedPokemon).trim().toLowerCase();
    const fpKey = normName(forcedPokemon);
    if (fpKey === 'nidoranm' || fpRaw === 'nidoran m' || fpRaw === 'nidoranm' || fpRaw === 'nidoran♂') {
      nidoranGenderHint = 'male';
    } else if (fpKey === 'nidoranw' || fpKey === 'nidoranf' || fpRaw === 'nidoran w' || fpRaw === 'nidoran f' || fpRaw === 'nidoranw' || fpRaw === 'nidoranf' || fpRaw === 'nidoran♀') {
      nidoranGenderHint = 'female';
    }
  }

  // Special case: "Nidoran" is ambiguous (♂ / ♀). Force explicit variant.
  // Use: !spawn Nidoranm or !spawn Nidoranw
  if (forcedPokemon && normName(forcedPokemon) === 'nidoran') {
    writeText(SPAWN_MESSAGE_TXT, '⚠️ Nidoran ist nicht eindeutig. Bitte !spawn Nidoranm oder !spawn Nidoranw benutzen.');
    log(`spawn blocked ambiguous nidoran raw=${JSON.stringify(rawInput || '')}`);
    return { ok: false, reason: 'ambiguous_nidoran' };
  }

  // Manual: allow forcing a specific pokemon name
  if (forcedPokemon) {
    const entry = dexEntryFor(forcedPokemon);

    // Force proper gender symbols for Nidoran variants (prevents overlay showing "Nidoranw"/"Nidoran w")
    if (entry && nidoranGenderHint) {
      if (nidoranGenderHint === 'female') {
        entry.dexId = 29;
        entry.name = 'Nidoran♀';
        entry.displayName = 'Nidoran♀';
      } else if (nidoranGenderHint === 'male') {
        entry.dexId = 32;
        entry.name = 'Nidoran♂';
        entry.displayName = 'Nidoran♂';
      }
    }
    const dexId = toDexId(entry);

    if (!dexId) {
      writeText(SPAWN_MESSAGE_TXT, `❌ Unbekanntes Pokémon: "${forcedPokemon}". Beispiel: !spawn epic oder !spawn Ibitak`);
      log(`spawn fail unknown pokemon forcedPokemon=${JSON.stringify(forcedPokemon)} raw=${JSON.stringify(rawInput || '')}`);
      return { ok: false, reason: 'unknown_pokemon' };
    }

    // guess rarity by pool membership, else forcedRarity, else common
    const guessedRarity =
      Object.keys(POOLS).find(r => (POOLS[r] || []).some(n => normName(n) === normName(forcedPokemon))) ||
      forcedRarity ||
      'common';

    const spriteUrl = (typeof entry === 'object' && entry?.spriteUrl) ? entry.spriteUrl : officialArtworkUrl(dexId);
    const niceName = canonicalName(forcedPokemon);
    const pokemon = {
      name: niceName,
      displayName: niceName,
      rarity: guessedRarity,
      isShiny: false,
      form: null,
      dexId,
      spriteUrl,
    };

    return { ok: true, pokemon, mode: 'manual', rawInput };
  }

  // Manual: allow forcing rarity
  const pokemon = rollPokemon(forcedRarity);
  return { ok: true, pokemon, mode: 'manual', rawInput };
}

function spawnManual(rawInput) {
  const prepared = prepareManual(rawInput);
  return prepared.ok ? startSpawn(prepared.pokemon, prepared.mode, prepared.rawInput) : prepared;
}

module.exports = { spawnAuto, spawnManual, prepareAuto, prepareManual, startPrepared: (job) => startSpawn(job.pokemon, job.mode, job.rawInput) };
