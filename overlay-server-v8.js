require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const paths = require("./lib/paths");
const overlayEventQueue = require("./lib/overlayEventQueue");
const rankedBattleQueue = require("./lib/rankedBattleQueue");
const rankedMatchmaker = require("./lib/rankedMatchmaker");
const rankedQueue = require("./lib/rankedQueue");
const { installWidgetApi } = require("./lib/widgetApi");
const { requireExtensionIdentity, widgetCors } = require("./lib/twitchExtensionAuth");

const app = express();
const BASE = __dirname;
const OVERLAY_DIR = path.join(BASE, "overlay");
const WIDGET_DIR = path.join(BASE, "widget");
const PRIVACY_FILE = path.join(BASE, "privacy", "index.html");
const SPRITES_DIR = path.join(BASE, "sprites");
const HOST = String(process.env.OVERLAY_HOST || "127.0.0.1");
const PORT = Number(process.env.OVERLAY_PORT || 3010);

function setNoCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.error(`[overlay] Fehler beim Lesen von ${path.basename(filePath)}:`, error.message);
    return fallback;
  }
}

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use("/api/widget", express.json({ limit: "32kb" }), widgetCors, requireExtensionIdentity);
installWidgetApi(app, { paths, readJsonSafe, setNoCache });

app.get(["/datenschutz", "/datenschutz/"], (_req, res) => {
  setNoCache(res);
  res.sendFile(PRIVACY_FILE);
});

app.use(express.static(OVERLAY_DIR, { etag: false, maxAge: 0 }));
if (fs.existsSync(WIDGET_DIR)) {
  app.use("/widget", express.static(WIDGET_DIR, { etag: false, maxAge: 0 }));
}
if (fs.existsSync(SPRITES_DIR)) app.use("/sprites", express.static(SPRITES_DIR));

app.get("/api/spawn", (_req, res) => {
  setNoCache(res);
  const fallback = { active: false, pokemon: null, endsAt: 0, participants: [] };
  res.json({ ...readJsonSafe(paths.SPAWN_JSON, fallback), serverNow: Date.now() });
});

app.get("/api/raid", (_req, res) => {
  setNoCache(res);
  res.json({ ...readJsonSafe(paths.RAID_STATE_JSON, { current: null }), serverNow: Date.now() });
});

app.get("/api/overlay-event", (_req, res) => {
  setNoCache(res);
  const event = overlayEventQueue.head(paths.OVERLAY_EVENT_QUEUE_JSON, readJsonSafe);
  res.json({
    event: event ? { id: event.id, type: event.type, status: event.status } : null,
    serverNow: Date.now(),
  });
});

app.get("/api/ranked-battle", (_req, res) => {
  setNoCache(res);
  const event = overlayEventQueue.claimHead(
    paths.OVERLAY_EVENT_QUEUE_JSON,
    readJsonSafe,
    "ranked"
  );
  if (!event) return res.json(null);
  const battle = rankedBattleQueue.claimNext(paths.RANKED_BATTLE_JSON, readJsonSafe);
  if (!battle || String(battle.id) !== String(event.battleId)) {
    console.error(`[overlay] Ranked-Queue stimmt nicht überein: Event ${event.battleId}, Battle ${battle?.id || "fehlt"}`);
    return res.status(409).json({ error: "ranked_queue_mismatch" });
  }
  res.json(battle);
});

app.post("/api/ranked-battle/:id/complete", (req, res) => {
  setNoCache(res);
  const result = rankedBattleQueue.complete(paths.RANKED_BATTLE_JSON, readJsonSafe, req.params.id);
  if (!result.ok) return res.status(result.reason === "not_found" ? 404 : 409).json(result);
  const job = result.job;
  if (!result.alreadyCompleted) {
    const profiles = readJsonSafe(paths.PROFILES_JSON, { users: {} });
    rankedMatchmaker.finalize(job, profiles);
    fs.writeFileSync(paths.PROFILES_JSON, JSON.stringify(profiles, null, 2));
    const queue = rankedQueue.readQueue(paths.RANKED_QUEUE_JSON, readJsonSafe);
    for (const player of job.players || []) delete queue.entries[String(player.userId)];
    rankedQueue.writeQueue(paths.RANKED_QUEUE_JSON, queue);
  }

  // Diese Bereinigung muss idempotent sein. Falls ein früherer Request nach
  // dem Markieren des Jobs abgebrochen ist, darf ein Retry den aktiven
  // Overlay-Eintrag nicht dauerhaft stehen lassen.
  const activeEvent = overlayEventQueue.head(paths.OVERLAY_EVENT_QUEUE_JSON, readJsonSafe);
  if (
    activeEvent?.type === "ranked" &&
    activeEvent.status === "active" &&
    String(activeEvent.battleId) === String(job.id)
  ) {
    overlayEventQueue.complete(
      paths.OVERLAY_EVENT_QUEUE_JSON,
      readJsonSafe,
      activeEvent.id
    );
  }
  // Der ausführliche Kampf bleibt unter rankedBattleLogs erhalten. Im
  // Live-State darf nach dem bestätigten Abschluss nichts Altes verbleiben.
  rankedBattleQueue.purgeCompleted(
    paths.RANKED_BATTLE_JSON,
    readJsonSafe,
    job.id
  );

  if (!result.alreadyCompleted) {
    const outbox = readJsonSafe(paths.CHAT_OUTBOX_JSON, { messages: [] });
    outbox.messages = Array.isArray(outbox.messages) ? outbox.messages : [];
    if (!outbox.messages.some((entry) => String(entry?.rankedBattleId) === String(job.id))) {
      outbox.messages.push({
        message: `⚔️ ${job.winnerDisplay} gewinnt den Ranked-Kampf (+20 LP).`,
        createdAt: Date.now(),
        rankedBattleId: job.id,
      });
      fs.writeFileSync(paths.CHAT_OUTBOX_JSON, JSON.stringify(outbox, null, 2));
    }
  }
  res.json({ ok: true, alreadyCompleted: result.alreadyCompleted });
});

app.get("/api/widget/player", (req, res) => {
  setNoCache(res);

  const userId = req.twitchUserId;

  const pokedex = readJsonSafe(paths.POKEDEX_JSON, { users: {} });
  const profiles = readJsonSafe(paths.PROFILES_JSON, { users: {} });
  const trades = readJsonSafe(paths.TRADES_JSON, { pending: [] });
  const dexmap = readJsonSafe(paths.DEXMAP_JSON, {});
  const evolutionRules = readJsonSafe(paths.EVOLUTIONS_JSON, { byDexId: {} });
  const raid = readJsonSafe(paths.RAID_STATE_JSON, { current: null });
  const rankedQueue = require("./lib/rankedQueue").readQueue(paths.RANKED_QUEUE_JSON, readJsonSafe);

  const dexUser = pokedex.users?.[userId] || null;
  const profile = profiles.users?.[userId] || null;
  if (!dexUser && !profile) {
    return res.status(404).json({ ok: false, error: "player_not_found" });
  }

  const caught = Array.isArray(dexUser?.caught) ? dexUser.caught : [];
  const history = Array.isArray(dexUser?.dexHistory) ? dexUser.dexHistory : [];
  const party = profile?.party || { activeSlot: 0, slots: Array(6).fill(null) };
  const pendingTrades = Array.isArray(trades.pending)
    ? trades.pending.filter((trade) =>
        [trade?.fromUserId, trade?.toUserId, trade?.requesterId, trade?.targetId]
          .filter(Boolean)
          .map(String)
          .includes(userId)
      )
    : [];

  const dex = Object.entries(dexmap)
    .map(([name, value]) =>
      value && typeof value === "object"
        ? { name, ...value }
        : {
            name,
            displayName: name.charAt(0).toUpperCase() + name.slice(1),
            dexId: Number(value) || null,
          }
    )
    .sort((a, b) => Number(a.dexId || 9999) - Number(b.dexId || 9999));

  const dexById = new Map(dex.map((entry) => [Number(entry.dexId), entry]));
  const availableEvolutions = caught.flatMap((mon) => {
    const rule = evolutionRules.byDexId?.[String(mon?.dexId)];
    if (!rule) return [];
    const caughtAt = Number(mon?.caughtAt || 0);
    const key = `${userId}:${caughtAt}`;
    const level = Math.max(1, Number(profile?.progress?.[key]?.level || mon?.level || 1));
    if (level < Number(rule.level) || profile?.evoLocked?.[key]) return [];
    const target = dexById.get(Number(rule.toDexId)) || {};
    return [{
      caughtAt,
      fromDexId: Number(mon.dexId),
      toDexId: Number(rule.toDexId),
      toName: target.displayName || target.name || `#${Number(rule.toDexId)}`,
      toSpriteUrl: target.spriteUrl || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${Number(rule.toDexId)}.png`,
    }];
  });

  return res.json({
    ok: true,
    serverNow: Date.now(),
    player: {
      id: userId,
      display: profile?.display || dexUser?.display || "Trainer",
      caught,
      history,
      party,
      progress: profile?.progress || {},
      items: profile?.items || {},
      ranked: require("./lib/ranked").publicRank(profiles, userId),
      rankedQueue: require("./lib/rankedQueue").publicEntry(rankedQueue, userId),
      availableEvolutions,
    },
    dex,
    multiplayer: {
      trades: pendingTrades,
      raid: raid.current || null,
      pvpAvailable: false,
    },
    notifications: pendingTrades.map((trade) => ({ type: "trade", trade })),
  });
});

app.get("/raidState.json", (_req, res) => {
  setNoCache(res);
  res.json({ ...readJsonSafe(paths.RAID_STATE_JSON, { current: null }), serverNow: Date.now() });
});

app.get("/api/health", (_req, res) => {
  setNoCache(res);
  res.json({
    ok: true,
    host: HOST,
    port: PORT,
    overlayDirExists: fs.existsSync(OVERLAY_DIR),
    spawnFileExists: fs.existsSync(paths.SPAWN_JSON),
    raidFileExists: fs.existsSync(paths.RAID_STATE_JSON),
    now: Date.now(),
  });
});

app.listen(PORT, HOST, () => {
  console.log(`[overlay] läuft auf http://${HOST}:${PORT}`);
  console.log(`[overlay] Datenordner: ${paths.DATA_DIR}`);
});
