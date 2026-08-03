require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const paths = require("./lib/paths");
const { installWidgetApi } = require("./lib/widgetApi");

const app = express();
const BASE = __dirname;
const OVERLAY_DIR = path.join(BASE, "overlay");
const WIDGET_DIR = path.join(BASE, "widget");
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

installWidgetApi(app, { paths, readJsonSafe, setNoCache });

app.disable("x-powered-by");
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

// Lokale Entwicklungsroute für das Twitch-Widget. Vor einer öffentlichen
// Freigabe wird userId durch die serverseitig geprüfte Twitch-Extension-
// Identität ersetzt.
app.get("/api/widget/player", (req, res) => {
  setNoCache(res);

  const userId = String(req.query.userId || "").trim();
  if (!userId) return res.status(400).json({ ok: false, error: "userId_missing" });

  const pokedex = readJsonSafe(paths.POKEDEX_JSON, { users: {} });
  const profiles = readJsonSafe(paths.PROFILES_JSON, { users: {} });
  const trades = readJsonSafe(paths.TRADES_JSON, { pending: [] });
  const dexmap = readJsonSafe(paths.DEXMAP_JSON, {});
  const raid = readJsonSafe(paths.RAID_STATE_JSON, { current: null });

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
