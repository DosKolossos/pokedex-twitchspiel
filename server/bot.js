require("dotenv").config();

const { TokenManager } = require("./token-manager");
const { TwitchApi } = require("./twitch-api");
const { EventSubConnection } = require("./eventsub");
const { GameAdapter } = require("./game-adapter");

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
const autoSpawnOnlyWhenLive = String(process.env.AUTO_SPAWN_ONLY_WHEN_LIVE || "true").toLowerCase() !== "false";

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
const twitch = new TwitchApi({ clientId, botUserId, broadcasterUserId, botTokenManager: botToken });
const game = new GameAdapter();

let streamLive = false;
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
    for (const [title, item] of Object.entries(custom)) result[normalizeTitle(title)] = String(item);
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

function scheduleSpawnResolve() {
  if (spawnTimer) clearTimeout(spawnTimer);
  const state = game.getSpawnState();
  if (!state?.active || !state?.pokemon) return;
  const delay = Math.max(0, Number(state.endsAt || 0) + spawnGraceMs - Date.now());
  spawnTimer = setTimeout(async () => {
    const output = await game.command("resolve", {}, "");
    if (output.message) await sendChat(output.message);
    spawnTimer = null;
  }, delay);
  console.log(`[timer] Spawn-Auflösung in ${Math.round(delay / 1000)}s`);
}

function scheduleRaidResolve() {
  if (raidTimer) clearTimeout(raidTimer);
  const state = game.getRaidState();
  if (!state?.current) return;
  const delay = Math.max(0, Number(state.current.joinEndsAt || 0) + raidGraceMs - Date.now());
  raidTimer = setTimeout(async () => {
    const output = await game.command("raidresolve", {}, "");
    if (output.message) await sendChat(output.message);
    raidTimer = null;
  }, delay);
  console.log(`[timer] Raid-Auflösung in ${Math.round(delay / 1000)}s`);
}

async function attemptAutoSpawn() {
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
  return badges.some((badge) => ["broadcaster", "moderator"].includes(String(badge.set_id || badge.id || "").toLowerCase()));
}

function parseCommand(message) {
  const trimmed = String(message || "").trim();
  if (!trimmed.startsWith("!")) return null;
  const [head, ...parts] = trimmed.split(/\s+/);
  return { name: head.slice(1).toLowerCase(), args: parts.join(" "), raw: trimmed };
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
]);

async function handleChatEvent(event) {
  const user = {
    userId: String(event.chatter_user_id || ""),
    userName: String(event.chatter_user_name || event.chatter_user_login || "User"),
    message: String(event.message?.text || ""),
  };
  if (!user.userId || user.userId === botUserId) return;

  const parsed = parseCommand(user.message);
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
  const title = normalizeTitle(event.reward?.title);
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
  if (type === "channel.chat.message") await handleChatEvent(event);
  if (type === "stream.online") {
    streamLive = true;
    console.log("[stream] online");
  }
  if (type === "stream.offline") {
    streamLive = false;
    console.log("[stream] offline");
  }
}

async function onRewardNotification(type, event) {
  if (type === "channel.channel_points_custom_reward_redemption.add") await handleReward(event);
}

const chatEventSub = new EventSubConnection({
  name: "chat",
  tokenManager: botToken,
  twitchApi: twitch,
  subscriptions: [
    {
      type: "channel.chat.message",
      condition: { broadcaster_user_id: broadcasterUserId, user_id: botUserId },
    },
    { type: "stream.online", condition: { broadcaster_user_id: broadcasterUserId } },
    { type: "stream.offline", condition: { broadcaster_user_id: broadcasterUserId } },
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
  const [botAuth, broadcasterAuth] = await Promise.all([botToken.validate(), broadcasterToken.validate()]);
  console.log(`[auth] Bot: ${botAuth.login} (${botAuth.user_id})`);
  console.log(`[auth] Kanal: ${broadcasterAuth.login} (${broadcasterAuth.user_id})`);
  if (String(botAuth.user_id) !== botUserId) throw new Error("BOT_USER_ID passt nicht zum Bot-Token");
  if (String(broadcasterAuth.user_id) !== broadcasterUserId) throw new Error("BROADCASTER_USER_ID passt nicht zum Broadcaster-Token");

  streamLive = await twitch.isStreamLive().catch(() => false);
  console.log(`[stream] Startstatus: ${streamLive ? "online" : "offline"}`);

  scheduleSpawnResolve();
  scheduleRaidResolve();

  await chatEventSub.start();
  await rewardEventSub.start();

  if (autoSpawnMinutes > 0) {
    setInterval(() => attemptAutoSpawn().catch((error) => console.error("[auto-spawn]", error)), autoSpawnMinutes * 60 * 1000);
    console.log(`[auto-spawn] alle ${autoSpawnMinutes} Minuten${autoSpawnOnlyWhenLive ? " (nur live)" : ""}`);
  } else {
    console.log("[auto-spawn] deaktiviert, bis der bisherige Timer bestätigt ist");
  }
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
process.on("unhandledRejection", (error) => console.error("[bot] Unhandled rejection:", error));
process.on("uncaughtException", (error) => {
  console.error("[bot] Uncaught exception:", error);
  process.exit(1);
});

main().catch((error) => {
  console.error("[bot] Start fehlgeschlagen:", error);
  process.exit(1);
});
