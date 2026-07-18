require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const paths = require("./lib/paths");

const app = express();
const BASE = __dirname;
const OVERLAY_DIR = path.join(BASE, "overlay");
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
app.use(express.static(OVERLAY_DIR, { etag: false, maxAge: 0 }));
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
