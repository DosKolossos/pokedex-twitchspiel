// local/poke.js
// Entry-point / dispatcher for PokéDex Twitch game.
//
// Recommended Streamer.bot shape:
//   node poke.js <cmd> "<userId>" "<userName>" "<rawInput...>"

const logger = require("./lib/logger");
const { log, err } = logger;

const paths = require("./lib/paths");
const xp = require("./lib/xp");
const store = require("./lib/fileStore");

function requireLazy(modPath) {
  try {
    return require(modPath);
  } catch (e) {
    err("require failed", modPath, e?.message || String(e));
    return null;
  }
}

function normCmd(raw) {
  return String(raw || "").trim().toLowerCase();
}

function joinArgs(parts) {
  return parts.filter(Boolean).join(" ").trim();
}

function ensurePrefix(rawInput, cmdWord) {
  const t = String(rawInput || "").trim();
  if (!t) return `!${cmdWord}`;

  const re = new RegExp(`^\\s*!?${cmdWord}\\b`, "i");

  // If already starts with cmdWord, ensure leading "!"
  if (re.test(t)) return t.startsWith("!") ? t : `!${t}`;

  // Otherwise prefix it
  return `!${cmdWord} ${t}`;
}

function describePokemon(p) {
  const shiny = p?.isShiny ? "✨ " : "";
  const n = p?.displayName || p?.name || "???";
  const r = String(p?.rarity || "").toUpperCase();
  return `${shiny}${n}${r ? ` (${r})` : ""}`;
}

function writeResolveMessage(text) {
  try {
    store.writeText(paths.RESOLVE_MESSAGE_TXT, text);
  } catch (e) {
    err("writeResolveMessage failed", e?.message || String(e));
  }
}

function missingModule(name) {
  const msg = `${name} module missing`;
  err(msg);
  console.log(msg);
  return { ok: false, reason: "module_missing", module: name };
}

function ensureDexHistoryEntry(userEntry, mon, ts = Date.now(), via = "catch") {
  if (!userEntry || !mon) return false;
  userEntry.dexHistory ??= [];

  const has = userEntry.dexHistory.some((h) => {
    if (!h) return false;
    if (mon?.dexId != null && h.dexId != null) return Number(h.dexId) === Number(mon.dexId);
    return String(h?.name || "").toLowerCase() === String(mon?.name || mon?.displayName || "").toLowerCase();
  });

  if (has) return false;

  userEntry.dexHistory.push({
    dexId: mon?.dexId ?? null,
    name: mon?.name || mon?.displayName || "?",
    firstOwnedAt: Number(ts) || Date.now(),
    lastOwnedAt: Number(ts) || Date.now(),
    via: String(via || "catch"),
  });
  return true;
}

// Resolve needs to persist catches because trade/party/dex rely on pokedex.json
function awardCatch(winner, pokemon) {
  const userId = String(winner?.userId || "").trim();
  const userName = String(winner?.userName || "").trim();
  if (!userId) return { ok: false, reason: "no_user" };

  const base = { users: {} };
  const pokedex = store.readJson(paths.POKEDEX_JSON, base) || base;
  if (!pokedex.users || typeof pokedex.users !== "object") pokedex.users = {};

  if (!pokedex.users[userId] || typeof pokedex.users[userId] !== "object") {
    pokedex.users[userId] = { id: userId, display: userName, caught: [] };
  }

  const entry = pokedex.users[userId];
  entry.id = userId;
  entry.display = userName || entry.display || "";
  if (!Array.isArray(entry.caught)) entry.caught = [];

  const caughtAt = Date.now();
  entry.caught.push({ ...pokemon, caughtAt });

  // Historischer Dex: einmal besessen = dauerhaft markiert
  ensureDexHistoryEntry(entry, pokemon, caughtAt, "catch");

  store.writeJson(paths.POKEDEX_JSON, pokedex);
  return { ok: true, caughtAt };
}

// ----------------------
// CLI parsing
// ----------------------
const [, , cmdRaw, arg1, arg2, ...rest] = process.argv;
const cmd = normCmd(cmdRaw);

// Standard: <cmd> <userId> <userName> <rawInput...>
let userId = String(arg1 || "").trim();
let userName = String(arg2 || "").trim();
let rawInput = joinArgs(rest);

// Fallback: if caller only passes rawInput
if (!rawInput && userId && !userName) {
  rawInput = userId;
  userId = "";
}

log("poke.dispatch", { file: __filename, cmd, userId, userName, rawInput });

try {
  switch (cmd) {
    // -----------------
    // Spawn
    // -----------------
    case "spawn": {
      const spawnModule = requireLazy("./lib/spawn");
      if (!spawnModule?.spawnAuto) return missingModule("spawn");
      return spawnModule.spawnAuto();
    }

    case "spawnm":
    case "spawnmanual": {
      const spawnModule = requireLazy("./lib/spawn");
      if (!spawnModule?.spawnManual) return missingModule("spawn");

      // normalize so spawn.js can parse rarity/pokemon reliably
      const input = ensurePrefix(rawInput, "spawn");
      return spawnModule.spawnManual(input);
    }

    // -----------------
    // Catch / Resolve
    // -----------------
    case "catch": {
      const cat = requireLazy("./lib/catch");
      if (!cat?.handleCatch) return missingModule("catch");
      return cat.handleCatch({ userId, userName });
    }

    case "resolve": {
      const cat = requireLazy("./lib/catch");
      if (!cat?.resolveCatch) return missingModule("catch");

      const res = cat.resolveCatch();

      if (!res?.ok) {
        if (res?.reason === "no_participants") {
          writeResolveMessage("");
          return res;
        }
        if (res?.reason === "no_spawn") {
          writeResolveMessage("");
          return res;
        }

        writeResolveMessage("⚠️ Resolve fehlgeschlagen.");
        return res;
      }

      const winner = res.winner;
      const pokemon = res.pokemon;
      const award = awardCatch(winner, pokemon);

      if (award.ok) {
        writeResolveMessage(`🎉 @${winner.userName} fängt ${describePokemon(pokemon)}!`);
      } else {
        writeResolveMessage(
          `🎉 ${describePokemon(pokemon)} wurde gefangen! (konnte nicht gespeichert werden)`
        );
      }

      return { ...res, award };
    }

    // -----------------
    // Trade
    // -----------------
    case "trade": {
      const t = requireLazy("./lib/trade");
      if (!t?.handleTrade) return missingModule("trade");
      return t.handleTrade({ userId, userName, rawInput: ensurePrefix(rawInput, "trade") });
    }

    case "accept": {
      const t = requireLazy("./lib/trade");
      if (!t?.handleAccept) return missingModule("trade");
      return t.handleAccept({ userId, userName, rawInput: ensurePrefix(rawInput, "accept") });
    }

    case "decline": {
      const t = requireLazy("./lib/trade");
      if (!t?.handleDecline) return missingModule("trade");
      return t.handleDecline({ userId, rawInput: ensurePrefix(rawInput, "decline") });
    }

    case "cancel": {
      const t = requireLazy("./lib/trade");
      if (!t?.handleCancel) return missingModule("trade");
      return t.handleCancel({ userId, rawInput: ensurePrefix(rawInput, "cancel") });
    }

    // -----------------
    // Team
    // -----------------
    case "team": {
      const p = requireLazy("./lib/party");
      if (!p?.cmdParty) return missingModule("team");
      return p.cmdParty(userId, userName, ensurePrefix(rawInput, "team"));
    }

    // -----------------
    // Dex
    // -----------------
    case "dex": {
      // Try module first; if it fails (e.g. version mismatch), fallback to internal summary.
      const dx = requireLazy("./lib/dex");
      if (dx?.handleDex) {
        try {
          return dx.handleDex({ userId, userName });
        } catch (e) {
          err("dex module failed, using fallback", e?.message || String(e));
        }
      }

      // Fallback dex summary
      store.ensureDirs();

      const uid = String(userId || "").trim();
      const uname = String(userName || "").trim();
      if (!uid) return { ok: false, reason: "no_user" };

      const pokedex = store.readJson(paths.POKEDEX_JSON, { users: {} }) || { users: {} };
      const u = pokedex.users?.[uid];
      const caught = Array.isArray(u?.caught) ? u.caught : [];
      const history = Array.isArray(u?.dexHistory) ? u.dexHistory : [];

      const uniqueKey = (p) =>
        p && p.dexId != null ? `dex:${p.dexId}` : `name:${(p?.name || p?.displayName || "?").toLowerCase()}`;
      const uniqueCurrent = new Set(caught.map(uniqueKey));
      const uniqueHistorical = new Set(
        (history.length ? history : caught).map((p) =>
          p && p.dexId != null ? `dex:${p.dexId}` : `name:${(p?.name || p?.displayName || "?").toLowerCase()}`
        )
      );

      const last5 = [...caught]
        .slice(-5)
        .reverse()
        .map((p) => {
          const name = p?.displayName || p?.name || "?";
          const rarity = (p?.rarity || "").toUpperCase();
          const id = p?.dexId != null ? `#${p.dexId}` : "?";
          const when = p?.caughtAt ? new Date(p.caughtAt).toLocaleString("de-DE") : "-";
          return `${name}${rarity ? ` (${rarity})` : ""} ${id} @ ${when}`;
        });

      const msg =
        `@${uname || "User"} Dex: ${uniqueHistorical.size} einzigartig | ` +
        `Im Besitz: ${uniqueCurrent.size} | Catches: ${caught.length}` +
        (last5.length ? ` | Letzte: ${last5.join(" | ")}` : "");

      store.writeText(paths.dexMessageFile(uid), msg);
      log("dex fallback ok", { uid, historical: uniqueHistorical.size, current: uniqueCurrent.size, total: caught.length });
      return { ok: true, historical: uniqueHistorical.size, current: uniqueCurrent.size, total: caught.length };
    }

    // -----------------
    // XP (chat activity)
    // -----------------
    case "chatxp": {
      const message = String(process.env.SB_MESSAGE ?? rawInput ?? "").trim();
      return xp.handleChatXp({ userId, userName, message });
    }

    // -----------------
    // Evolution
    // -----------------
    case "evo": {
      const evo = requireLazy("./lib/evo");
      if (!evo?.handleEvo) return missingModule("evo");
      return evo.handleEvo({ userId, userName, rawInput: ensurePrefix(rawInput, "evo") });
    }

    // -----------------
    // Items
    // -----------------
    case "items": {
      const it = requireLazy("./lib/items");
      if (!it?.handleItems) return missingModule("items");
      return it.handleItems({ userId, userName });
    }

    case "grantitem": {
      const it = requireLazy("./lib/items");
      if (!it?.handleGrantItem) return missingModule("items");
      return it.handleGrantItem({ userId, userName, rawInput });
    }

    case "item": {
      const it = requireLazy("./lib/items");
      if (!it?.handleItemUse) return missingModule("items");
      return it.handleItemUse({ userId, userName, rawInput });
    }

    // -----------------
    // Raid
    // -----------------
    case "raid": {
      const raidModule = requireLazy("./lib/raid");
      if (!raidModule?.handleRaid) return missingModule("raid");
      return raidModule.handleRaid({ userId, userName, rawInput });
    }

    case "raidspawn": {
      const raidModule = requireLazy("./lib/raid");
      if (!raidModule?.spawnRaid) return missingModule("raid");
      return raidModule.spawnRaid({ userId, userName, rawInput });
    }

    case "raidresolve": {
      const raidModule = requireLazy("./lib/raid");
      if (!raidModule?.resolveRaid) return missingModule("raid");
      // log("raidresolve command reached"); // optional debug
      return raidModule.resolveRaid();
    }

    case "raidstatus": {
      const raidModule = requireLazy("./lib/raid");
      if (!raidModule?.writeRaidStatus) return missingModule("raid");
      return raidModule.writeRaidStatus();
    }

    default:
      console.log("Usage:");
      console.log("  node poke.js spawn");
      console.log('  node poke.js spawnm "<userId>" "<userName>" "<rawInput>"');
      console.log('  node poke.js catch "<userId>" "<userName>"');
      console.log("  node poke.js resolve");
      console.log('  node poke.js trade "<userId>" "<userName>" "<rawInput>"');
      console.log('  node poke.js accept|decline|cancel "<userId>" "<userName>" "<rawInput>"');
      console.log('  node poke.js party "<userId>" "<userName>" "<rawInput>"');
      console.log('  node poke.js dex "<userId>" "<userName>"');
      console.log('  node poke.js chatxp "<userId>" "<userName>" "<rawInput>"');
      console.log('  node poke.js evo "<userId>" "<userName>" "<rawInput>"');
      console.log('  node poke.js items "<userId>" "<userName>"');
      console.log('  node poke.js grantitem "<userId>" "<userName>" "<itemId> [amount]"');
      console.log('  node poke.js item "<userId>" "<userName>" "<rawInput>"');
      console.log('  node poke.js raid "<userId>" "<userName>" "<rawInput>"');
      console.log('  node poke.js raidspawn "<userId>" "<userName>" "<tier cp>"');
      console.log("  node poke.js raidresolve");
      console.log("  node poke.js raidstatus");
      return;
  }
} catch (e) {
  err("poke.js crash", e?.stack || String(e));
  throw e;
}
