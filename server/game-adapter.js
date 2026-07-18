const paths = require("../lib/paths");
const store = require("../lib/fileStore");
const spawn = require("../lib/spawn");
const catching = require("../lib/catch");
const trade = require("../lib/trade");
const party = require("../lib/party");
const dex = require("../lib/dex");
const xp = require("../lib/xp");
const evo = require("../lib/evo");
const items = require("../lib/items");
const raid = require("../lib/raid");

function describePokemon(p) {
  const shiny = p?.isShiny ? "✨ " : "";
  const name = p?.displayName || p?.name || "???";
  const rarity = String(p?.rarity || "").toUpperCase();
  return `${shiny}${name}${rarity ? ` (${rarity})` : ""}`;
}

function ensureDexHistoryEntry(userEntry, mon, ts = Date.now(), via = "catch") {
  userEntry.dexHistory ??= [];
  const has = userEntry.dexHistory.some((entry) => {
    if (mon?.dexId != null && entry?.dexId != null) return Number(entry.dexId) === Number(mon.dexId);
    return String(entry?.name || "").toLowerCase() === String(mon?.name || mon?.displayName || "").toLowerCase();
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

function awardCatch(winner, pokemon) {
  const userId = String(winner?.userId || "").trim();
  const userName = String(winner?.userName || "").trim();
  if (!userId) return { ok: false, reason: "no_user" };

  const pokedex = store.readJson(paths.POKEDEX_JSON, { users: {} }) || { users: {} };
  pokedex.users ??= {};
  pokedex.users[userId] ??= { id: userId, display: userName, caught: [] };
  const entry = pokedex.users[userId];
  entry.id = userId;
  entry.display = userName || entry.display || "";
  entry.caught = Array.isArray(entry.caught) ? entry.caught : [];

  const caughtAt = Date.now();
  entry.caught.push({ ...pokemon, caughtAt });
  ensureDexHistoryEntry(entry, pokemon, caughtAt, "catch");
  store.writeJson(paths.POKEDEX_JSON, pokedex);
  return { ok: true, caughtAt };
}

function text(file) {
  return store.readText(file, "").trim();
}

function prefix(rawInput, cmd) {
  const value = String(rawInput || "").trim();
  if (!value) return `!${cmd}`;
  if (new RegExp(`^!?${cmd}\\b`, "i").test(value)) return value.startsWith("!") ? value : `!${value}`;
  return `!${cmd} ${value}`;
}

class GameAdapter {
  constructor() {
    this.queue = Promise.resolve();
  }

  run(task) {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => {});
    return result;
  }

  chatXp(user) {
    return this.run(() => xp.handleChatXp({
      userId: user.userId,
      userName: user.userName,
      message: user.message,
    }));
  }

  command(command, user, rawInput = "") {
    return this.run(() => this.execute(command, user, rawInput));
  }

  execute(command, user, rawInput) {
    const userId = String(user?.userId || "");
    const userName = String(user?.userName || "");
    switch (command) {
      case "spawn": {
        const result = rawInput ? spawn.spawnManual(prefix(rawInput, "spawn")) : spawn.spawnAuto();
        return { result, message: text(paths.SPAWN_MESSAGE_TXT), schedule: result?.ok ? "spawn" : null };
      }
      case "catch": {
        const result = catching.handleCatch({ userId, userName });
        return { result, message: text(paths.CATCH_MESSAGE_TXT) };
      }
      case "resolve": {
        const result = catching.resolveCatch();
        let message = "";
        if (!result?.ok) {
          if (result?.reason === "no_participants") message = "😶 Das wilde Pokémon verschwindet wieder im hohen Gras.";
          else if (result?.reason !== "no_spawn") message = "⚠️ Resolve fehlgeschlagen.";
        } else {
          const award = awardCatch(result.winner, result.pokemon);
          message = award.ok
            ? `🎉 @${result.winner.userName} fängt ${describePokemon(result.pokemon)}!`
            : `🎉 ${describePokemon(result.pokemon)} wurde gefangen! (konnte nicht gespeichert werden)`;
          result.award = award;
        }
        store.writeText(paths.RESOLVE_MESSAGE_TXT, message);
        return { result, message };
      }
      case "dex":
        dex.handleDex({ userId, userName });
        return { result: { ok: true }, message: text(paths.dexMessageFile(userId)) };
      case "team":
        party.cmdParty(userId, userName, prefix(rawInput, "team"));
        return { result: { ok: true }, message: text(paths.partyMessageFile(userId)) };
      case "evo":
        evo.handleEvo({ userId, userName, rawInput: prefix(rawInput, "evo") });
        return { result: { ok: true }, message: text(paths.evoMessageFile(userId)) };
      case "items":
        items.handleItems({ userId, userName });
        return { result: { ok: true }, message: text(paths.itemMessageFile(userId)) };
      case "item":
        items.handleItemUse({ userId, userName, rawInput: prefix(rawInput, "item") });
        return { result: { ok: true }, message: text(paths.itemMessageFile(userId)) };
      case "grantitem":
        items.handleGrantItem({ userId, userName, rawInput });
        return { result: { ok: true }, message: text(paths.itemMessageFile(userId)) };
      case "trade":
        trade.handleTrade({ userId, userName, rawInput: prefix(rawInput, "trade") });
        return { result: { ok: true }, message: text(paths.tradeMessageFile(userId)) };
      case "accept":
        trade.handleAccept({ userId, userName, rawInput: prefix(rawInput, "accept") });
        return { result: { ok: true }, message: text(paths.tradeMessageFile(userId)) };
      case "decline":
        trade.handleDecline({ userId, rawInput: prefix(rawInput, "decline") });
        return { result: { ok: true }, message: text(paths.tradeMessageFile(userId)) };
      case "cancel":
        trade.handleCancel({ userId, rawInput: prefix(rawInput, "cancel") });
        return { result: { ok: true }, message: text(paths.tradeMessageFile(userId)) };
      case "raid": {
        const result = raid.handleRaid({ userId, userName, rawInput: prefix(rawInput, "raid") });
        return { result, message: text(paths.RAID_MESSAGE_TXT) };
      }
      case "raidspawn": {
        const result = raid.spawnRaid({ userId, userName, rawInput });
        return { result, message: text(paths.RAID_MESSAGE_TXT), schedule: result?.ok ? "raid" : null };
      }
      case "raidresolve": {
        const result = raid.resolveRaid();
        return { result, message: text(paths.RAID_MESSAGE_TXT) };
      }
      case "raidstatus": {
        const result = raid.writeRaidStatus();
        return { result, message: text(paths.RAID_MESSAGE_TXT) };
      }
      default:
        return { result: { ok: false, reason: "unknown_command" }, message: "" };
    }
  }

  getSpawnState() {
    return store.readJson(paths.SPAWN_JSON, { active: false, endsAt: 0, pokemon: null, participants: [] });
  }

  getRaidState() {
    return store.readJson(paths.RAID_STATE_JSON, { current: null });
  }
}

module.exports = { GameAdapter };
