require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { TokenManager } = require("./token-manager");
const { TwitchApi } = require("./twitch-api");
const { EventSubConnection } = require("./eventsub");
const { GameAdapter } = require("./game-adapter");
const store = require("../lib/fileStore");
const paths = require("../lib/paths");
const rankedQueue = require("../lib/rankedQueue");

const required = [
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
  "BROADCASTER_USER_ID",
  "BOT_USER_ID",
  "BOT_ACCESS_TOKEN",
  "BOT_REFRESH_TOKEN",
  "BROADCASTER_ACCESS_TOKEN",
  "BROADCASTER_REFRESH_TOKEN",
];
const missing = required.filter((key) => !String(process.env[key] || "").trim());
if (missing.length) {
  console.error(`[bot] Konfiguration fehlt: ${missing.join(", ")}`);
  console.error("[bot] .env aus .env.example erstellen. Bot wird nicht gestartet.");
  process.exit(1);
}

const clientId = process.env.TWITCH_CLIENT_ID.trim();
const clientSecret = process.env.TWITCH_CLIENT_SECRET.trim();
const broadcasterUserId = process.env.BROADCASTER_USER_ID.trim();
const botUserId = process.env.BOT_USER_ID.trim();
const maxLength = Number(process.env.CHAT_MESSAGE_MAX_LENGTH || 480);
const sendDelayMs = Number(process.env.CHAT_SEND_DELAY_MS || 1100);
const spawnGraceMs = Number(process.env.SPAWN_RESOLVE_GRACE_SECONDS || 5) * 1000;
const raidGraceMs = Number(process.env.RAID_RESOLVE_GRACE_SECONDS || 2) * 1000;
const autoSpawnMinutes = Number(process.env.AUTO_SPAWN_INTERVAL_MINUTES || 0);
const autoSpawnOnlyWhenLive =
  String(process.env.AUTO_SPAWN_ONLY_WHEN_LIVE || "true").toLowerCase() !== "false";

const runtimeDir = path.join(__dirname, "..", "runtime");
const controlStateFile = path.join(runtimeDir, "game-control.json");

const botToken = new TokenManager({
  name: "bot",
  clientId,
  clientSecret,
  accessToken: process.env.BOT_ACCESS_TOKEN,
  refreshToken: process.env.BOT_REFRESH_TOKEN,
});
const broadcasterToken = new TokenManager({
  name: "broadcaster",
  clientId,
  clientSecret,
  accessToken: process.env.BROADCASTER_ACCESS_TOKEN,
  refreshToken: process.env.BROADCASTER_REFRESH_TOKEN,
});
const twitch = new TwitchApi({
  clientId,
  botUserId,
  broadcasterUserId,
  botTokenManager: botToken,
});
const game = new GameAdapter();

let streamLive = false;
let gameEnabled = false;
let manualOverride = null;
let gameEnabledSource = "Start";
let spawnTimer = null;
let raidTimer = null;
let chatSendQueue = Promise.resolve();

const defaultRewardMap = {
  blattstein: "leaf_stone",
  donnerstein: "thunder_stone",
  feuerstein: "fire_stone",
  mondstein: "moon_stone",
  wasserstein: "water_stone",
  "xp bonbon s": "xp_candy_s",
  "xp bonbon m": "xp_candy_m",
  "xp bonbon l": "xp_candy_l",
  "xp-bonbon s": "xp_candy_s",
  "xp-bonbon m": "xp_candy_m",
  "xp-bonbon l": "xp_candy_l",
};

function normalizeTitle(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getRewardMap() {
  const result = { ...defaultRewardMap };
  if (process.env.REWARD_ITEM_MAP_JSON) {
    const custom = JSON.parse(process.env.REWARD_ITEM_MAP_JSON);
    for (const [title, item] of Object.entries(custom)) {
      result[normalizeTitle(title)] = String(item);
    }
  }
  return result;
}
const rewardMap = getRewardMap();

function splitMessage(message) {
  const text = String(message || "").trim();
  if (!text) return [];
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf(" ", maxLength);
    if (cut < Math.floor(maxLength * 0.5)) cut = maxLength;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendChat(message) {
  for (const chunk of splitMessage(message)) {
    chatSendQueue = chatSendQueue
      .then(() => twitch.sendChatMessage(chunk))
      .then(() => sleep(sendDelayMs))
      .catch((error) => console.error("[chat] Senden fehlgeschlagen:", error.message));
  }
  return chatSendQueue;
}

function readControlState() {
  try {
    const value = JSON.parse(fs.readFileSync(controlStateFile, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function persistControlState() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const tempFile = `${controlStateFile}.${process.pid}.tmp`;
  const state = {
    version: 1,
    enabled: gameEnabled,
    manualOverride,
    streamLive,
    source: gameEnabledSource,
    updatedAt: Date.now(),
  };
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tempFile, controlStateFile);
  try {
    fs.chmodSync(controlStateFile, 0o600);
  } catch {}
}

function statusText() {
  const state = gameEnabled ? "aktiv" : "deaktiviert";
  const stream = streamLive ? "Stream online" : "Stream offline";
  return `Pokédexspiel: ${state} (${gameEnabledSource}; ${stream}).`;
}

async function setGameEnabled(nextEnabled, options = {}) {
  const next = Boolean(nextEnabled);
  const source = String(options.source || "System");
  const override =
    typeof options.manualOverride === "boolean" ? options.manualOverride : null;
  const changed = gameEnabled !== next;

  gameEnabled = next;
  manualOverride = override;
  gameEnabledSource = source;
  persistControlState();

  if (changed) {
    const removed = rankedQueue.clearQueue(paths.RANKED_QUEUE_JSON, store.readJsonSafe);
    console.log(`[ranked] Queue wegen Spiel-${gameEnabled ? "Start" : "Stopp"} beendet (${removed} Einträge)`);
  }

  if (gameEnabled) {
    scheduleSpawnResolve();
    scheduleRaidResolve();
  }

  console.log(
    `[game] ${gameEnabled ? "aktiviert" : "deaktiviert"} durch ${gameEnabledSource}${changed ? "" : " (unverändert)"}`
  );
  return changed;
}

function initializeGameControl() {
  const saved = readControlState();

  if (
    saved.streamLive === streamLive &&
    typeof saved.manualOverride === "boolean"
  ) {
    manualOverride = saved.manualOverride;
    gameEnabled = saved.manualOverride;
    gameEnabledSource = String(saved.source || "gespeicherte Mod-Einstellung");
  } else {
    manualOverride = null;
    gameEnabled = streamLive;
    gameEnabledSource = streamLive ? "Stream bereits online" : "Stream offline";
  }

  persistControlState();
  const removed = rankedQueue.clearQueue(paths.RANKED_QUEUE_JSON, store.readJsonSafe);
  console.log(`[ranked] Queue beim Bot-Start bereinigt (${removed} Einträge)`);
  console.log(`[game] Startstatus: ${statusText()}`);
}

function scheduleSpawnResolve() {
  if (spawnTimer) clearTimeout(spawnTimer);
  const state = game.getSpawnState();
  if (!state?.active || !state?.pokemon) return;
  const delay = Math.max(
    0,
    Number(state.endsAt || 0) + spawnGraceMs - Date.now()
  );
  spawnTimer = setTimeout(async () => {
    const output = await game.command("resolve", {}, "");
    if (gameEnabled && output.message) await sendChat(output.message);
    spawnTimer = null;
  }, delay);
  console.log(`[timer] Spawn-Auflösung in ${Math.round(delay / 1000)}s`);
}

function scheduleRaidResolve() {
  if (raidTimer) clearTimeout(raidTimer);
  const state = game.getRaidState();
  if (!state?.current) return;
  const delay = Math.max(
    0,
    Number(state.current.joinEndsAt || 0) + raidGraceMs - Date.now()
  );
  raidTimer = setTimeout(async () => {
    const output = await game.command("raidresolve", {}, "");
    if (gameEnabled && output.message) await sendChat(output.message);
    raidTimer = null;
  }, delay);
  console.log(`[timer] Raid-Auflösung in ${Math.round(delay / 1000)}s`);
}

async function attemptAutoSpawn() {
  if (!gameEnabled) return;
  if (autoSpawnOnlyWhenLive && !streamLive) return;
  const output = await game.command("spawn", {}, "");
  if (output.result?.ok && output.message) {
    await sendChat(output.message);
    scheduleSpawnResolve();
  }
}

function isAdmin(event) {
  if (String(event.chatter_user_id) === broadcasterUserId) return true;
  const badges = Array.isArray(event.badges) ? event.badges : [];
  return badges.some((badge) =>
    ["broadcaster", "moderator"].includes(
      String(badge.set_id || badge.id || "").toLowerCase()
    )
  );
}

function parseCommand(message) {
  const trimmed = String(message || "").trim();
  if (!trimmed.startsWith("!")) return null;
  const [head, ...parts] = trimmed.split(/\s+/);
  return {
    name: head.slice(1).toLowerCase(),
    args: parts.join(" "),
    raw: trimmed,
  };
}

function controlAction(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["on", "an", "start"].includes(normalized)) return "on";
  if (["off", "aus", "stop"].includes(normalized)) return "off";
  if (["status", "state"].includes(normalized)) return "status";
  return null;
}

async function handleControlCommand(event, parsed, user) {
  if (parsed.name !== "pokedex") return false;

  const action = controlAction(parsed.args);
  if (!action) return false;

  if (action === "status") {
    await sendChat(`@${user.userName} ${statusText()}`);
    return true;
  }

  if (!isAdmin(event)) {
    await sendChat(`@${user.userName} Nur Mods können das Pokédexspiel an- oder ausschalten.`);
    return true;
  }

  const enable = action === "on";
  await setGameEnabled(enable, {
    source: `Mod ${user.userName}`,
    manualOverride: enable,
  });
  await sendChat(
    `@${user.userName} Das Pokédexspiel ist jetzt ${enable ? "aktiv" : "deaktiviert"}.`
  );
  return true;
}

const aliases = new Map([
  ["catch", "catch"],
  ["fang", "catch"],
  ["mypokemon", "dex"],
  ["pokemon", "dex"],
  ["dex", "dex"],
  ["pokedex", "dex"],
  ["party", "team"],
  ["team", "team"],
  ["evolution", "evo"],
  ["evo", "evo"],
  ["items", "items"],
  ["item", "item"],
  ["trade", "trade"],
  ["accept", "accept"],
  ["decline", "decline"],
  ["cancel", "cancel"],
  ["raid", "raid"],
  ["ranked", "ranked"],
]);

async function handleChatEvent(event) {
  const user = {
    userId: String(event.chatter_user_id || ""),
    userName: String(
      event.chatter_user_name || event.chatter_user_login || "User"
    ),
    message: String(event.message?.text || ""),
  };
  if (!user.userId || user.userId === botUserId) return;

  const presence = store.readJson(paths.CHAT_PRESENCE_JSON, { users: {} }) || { users: {} };
  presence.users ??= {};
  presence.users[user.userId] = { id: user.userId, display: user.userName, lastSeenAt: Date.now() };
  for (const [id, entry] of Object.entries(presence.users)) {
    if (Date.now() - Number(entry?.lastSeenAt || 0) > 30 * 60 * 1000) delete presence.users[id];
  }
  store.writeJson(paths.CHAT_PRESENCE_JSON, presence);

  const parsed = parseCommand(user.message);
  if (parsed && (await handleControlCommand(event, parsed, user))) return;

  if (!gameEnabled) return;

  if (!parsed) {
    await game.chatXp(user);
    return;
  }

  let command = aliases.get(parsed.name);
  let rawInput = parsed.raw;

  if (parsed.name === "spawn" && isAdmin(event)) command = "spawn";
  if (parsed.name === "raidspawn" && isAdmin(event)) command = "raidspawn";
  if (parsed.name === "raidresolve" && isAdmin(event)) command = "raidresolve";
  if (!command) return;

  const adminCommands = new Set(["spawn", "raidspawn", "raidresolve"]);
  if (adminCommands.has(command) && !isAdmin(event)) return;

  if (command === "spawn") rawInput = parsed.raw;
  const output = await game.command(command, user, rawInput);
  if (output.message) await sendChat(output.message);
  if (output.schedule === "spawn") scheduleSpawnResolve();
  if (output.schedule === "raid") scheduleRaidResolve();
}

async function handleReward(event) {
  if (!gameEnabled) {
    console.log(
      `[reward] ignoriert, weil das Spiel deaktiviert ist: ${event.reward?.title || "?"}`
    );
    return;
  }

  const title = normalizeTitle(event.reward?.title);
  if (title === "wesen ändern") {
    const user = { userId:String(event.user_id || ""), userName:String(event.user_name || event.user_login || "User") };
    const output = await game.command("nature", user, String(event.user_input || ""));
    const valid = Boolean(output.result?.ok);
    let redemptionUpdated = false;
    try {
      await twitch.updateRedemptionStatus({ rewardId:event.reward?.id, redemptionId:event.id, status:valid?"FULFILLED":"CANCELED", tokenManager:broadcasterToken });
      redemptionUpdated = true;
    } catch (error) { console.error("[nature] Einlösungsstatus:", error.message); }
    if (valid && output.message) await sendChat(output.message);
    else if (!valid) {
      const reason = output.result?.reason === "no_active_pokemon" ? "Du hast kein aktives Pokémon." : "Wesen nicht erkannt. Beispiele: Mäßig/Modest, Hart/Adamant, Scheu/Timid.";
      await sendChat(`⚠️ @${user.userName}: ${reason}${redemptionUpdated ? " Die Kanalpunkte wurden zurückerstattet." : " Bitte die Einlösung manuell ablehnen."}`);
    }
    return;
  }
  const itemId = rewardMap[title];
  if (!itemId) {
    console.log(`[reward] nicht zugeordnet: ${event.reward?.title || "?"}`);
    return;
  }
  const user = {
    userId: String(event.user_id || ""),
    userName: String(event.user_name || event.user_login || "User"),
  };
  const output = await game.command("grantitem", user, `${itemId} 1`);
  if (output.message) await sendChat(output.message);
}

async function onChatNotification(type, event) {
  if (type === "channel.chat.message") {
    await handleChatEvent(event);
    return;
  }

  if (type === "stream.online") {
    streamLive = true;
    console.log("[stream] online");
    await setGameEnabled(true, {
      source: "Streamstart",
      manualOverride: null,
    });
    return;
  }

  if (type === "stream.offline") {
    streamLive = false;
    console.log("[stream] offline");
    await setGameEnabled(false, {
      source: "Streamende",
      manualOverride: null,
    });
  }
}

async function onRewardNotification(type, event) {
  if (type === "channel.channel_points_custom_reward_redemption.add") {
    await handleReward(event);
  }
}

async function flushWidgetOutbox() {
  const outbox = store.readJson(paths.CHAT_OUTBOX_JSON, { messages: [] }) || { messages: [] };
  if (!Array.isArray(outbox.messages) || !outbox.messages.length) return;
  const [next, ...remaining] = outbox.messages;
  await sendChat(String(next.message || ""));
  store.writeJson(paths.CHAT_OUTBOX_JSON, { messages: remaining });
}

const chatEventSub = new EventSubConnection({
  name: "chat",
  tokenManager: botToken,
  twitchApi: twitch,
  subscriptions: [
    {
      type: "channel.chat.message",
      condition: {
        broadcaster_user_id: broadcasterUserId,
        user_id: botUserId,
      },
    },
    {
      type: "stream.online",
      condition: { broadcaster_user_id: broadcasterUserId },
    },
    {
      type: "stream.offline",
      condition: { broadcaster_user_id: broadcasterUserId },
    },
  ],
  onNotification: onChatNotification,
});

const rewardEventSub = new EventSubConnection({
  name: "rewards",
  tokenManager: broadcasterToken,
  twitchApi: twitch,
  subscriptions: [
    {
      type: "channel.channel_points_custom_reward_redemption.add",
      condition: { broadcaster_user_id: broadcasterUserId },
    },
  ],
  onNotification: onRewardNotification,
});

async function main() {
  await Promise.all([
    botToken.getAccessToken(),
    broadcasterToken.getAccessToken(),
  ]);
  const [botAuth, broadcasterAuth] = await Promise.all([
    botToken.validate(),
    broadcasterToken.validate(),
  ]);
  console.log(`[auth] Bot: ${botAuth.login} (${botAuth.user_id})`);
  console.log(
    `[auth] Kanal: ${broadcasterAuth.login} (${broadcasterAuth.user_id})`
  );
  if (String(botAuth.user_id) !== botUserId) {
    throw new Error("BOT_USER_ID passt nicht zum Bot-Token");
  }
  if (String(broadcasterAuth.user_id) !== broadcasterUserId) {
    throw new Error(
      "BROADCASTER_USER_ID passt nicht zum Broadcaster-Token"
    );
  }

  streamLive = await twitch.isStreamLive().catch(() => false);
  console.log(`[stream] Startstatus: ${streamLive ? "online" : "offline"}`);
  initializeGameControl();

  // Bereits laufende Spawns/Raids werden auch im deaktivierten Zustand
  // zum vorgesehenen Zeitpunkt still aufgelöst, damit kein Zustand hängen bleibt.
  scheduleSpawnResolve();
  scheduleRaidResolve();

  await chatEventSub.start();
  await rewardEventSub.start();
  setInterval(() => flushWidgetOutbox().catch((error) => console.error("[widget-outbox]", error)), 1500);

  if (autoSpawnMinutes > 0) {
    setInterval(
      () =>
        attemptAutoSpawn().catch((error) =>
          console.error("[auto-spawn]", error)
        ),
      autoSpawnMinutes * 60 * 1000
    );
    console.log(
      `[auto-spawn] alle ${autoSpawnMinutes} Minuten${autoSpawnOnlyWhenLive ? " (nur live)" : ""}`
    );
  } else {
    console.log(
      "[auto-spawn] deaktiviert, bis der bisherige Timer bestätigt ist"
    );
  }

  console.log(
    "[game] Steuerung: !pokedex on | !pokedex off | !pokedex status (an/aus/start/stop ebenfalls möglich)"
  );
}

function shutdown(signal) {
  console.log(`[bot] ${signal}: fahre sauber herunter`);
  chatEventSub.stop();
  rewardEventSub.stop();
  if (spawnTimer) clearTimeout(spawnTimer);
  if (raidTimer) clearTimeout(raidTimer);
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (error) =>
  console.error("[bot] Unhandled rejection:", error)
);
process.on("uncaughtException", (error) => {
  console.error("[bot] Uncaught exception:", error);
  process.exit(1);
});

main().catch((error) => {
  console.error("[bot] Start fehlgeschlagen:", error);
  process.exit(1);
});
