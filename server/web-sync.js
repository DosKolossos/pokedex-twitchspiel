"use strict";

require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(process.env.POKEDEX_DATA_DIR || path.join(ROOT, "data"));
const RUNTIME_DIR = path.join(ROOT, "runtime");
const STATE_FILE = path.join(RUNTIME_DIR, "web-sync-state.json");

const host = String(process.env.WEB_SYNC_HOST || "").trim()
  .replace(/^ftps?:\/\//i, "")
  .replace(/\/+$/, "");
const username = String(process.env.WEB_SYNC_USERNAME || "").trim();
const password = String(process.env.WEB_SYNC_PASSWORD || "");
const remoteDirRaw = String(process.env.WEB_SYNC_REMOTE_DIR || "/schiggygang.de/JSON").trim();
const intervalSeconds = Math.max(2, Number(process.env.WEB_SYNC_INTERVAL_SECONDS || 5));
const runOnce = String(process.env.WEB_SYNC_ONCE || "false").toLowerCase() === "true";
const files = String(
  process.env.WEB_SYNC_FILES ||
    "pokedex.json,profiles.json,spawn.json,resolveMessage.txt,spawnMessage.txt,catchMessage.txt"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const missing = [];
if (!host) missing.push("WEB_SYNC_HOST");
if (!username) missing.push("WEB_SYNC_USERNAME");
if (!password) missing.push("WEB_SYNC_PASSWORD");
if (missing.length) {
  console.error(`[web-sync] Konfiguration fehlt: ${missing.join(", ")}`);
  process.exit(1);
}

if (!/^[a-z0-9.-]+$/i.test(host)) {
  console.error("[web-sync] WEB_SYNC_HOST enthält ungültige Zeichen.");
  process.exit(1);
}
if (remoteDirRaw.includes("..")) {
  console.error("[web-sync] WEB_SYNC_REMOTE_DIR darf kein '..' enthalten.");
  process.exit(1);
}
if (files.some((name) => !/^[a-zA-Z0-9._-]+$/.test(name))) {
  console.error("[web-sync] WEB_SYNC_FILES enthält einen ungültigen Dateinamen.");
  process.exit(1);
}

const remoteDir = `/${remoteDirRaw.replace(/^\/+|\/+$/g, "")}`;
let running = false;
let stopped = false;
let state = readState();

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeState() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, STATE_FILE);
  try {
    fs.chmodSync(STATE_FILE, 0o600);
  } catch {}
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function quoteCurlConfig(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, "")}"`;
}

function uploadFile(localPath, fileName) {
  return new Promise((resolve, reject) => {
    const remoteUrl = `ftp://${host}${remoteDir}/${encodeURIComponent(fileName)}`;
    const args = [
      "--config",
      "-",
      "--silent",
      "--show-error",
      "--fail",
      "--ssl-reqd",
      "--ftp-pasv",
      "--ftp-create-dirs",
      "--connect-timeout",
      "15",
      "--max-time",
      "60",
      "--retry",
      "2",
      "--retry-delay",
      "2",
      "--upload-file",
      localPath,
      remoteUrl,
    ];

    const child = spawn("curl", args, {
      cwd: ROOT,
      stdio: ["pipe", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `curl wurde mit Code ${code} beendet`));
      }
    });

    child.stdin.end(`user = ${quoteCurlConfig(`${username}:${password}`)}\n`);
  });
}

async function syncOnce() {
  if (running || stopped) return;
  running = true;

  try {
    let changed = 0;

    for (const fileName of files) {
      const localPath = path.join(DATA_DIR, fileName);
      if (!fs.existsSync(localPath)) {
        console.warn(`[web-sync] Datei fehlt, übersprungen: ${fileName}`);
        continue;
      }

      const currentHash = sha256(localPath);
      if (state[fileName]?.sha256 === currentHash) continue;

      await uploadFile(localPath, fileName);
      state[fileName] = {
        sha256: currentHash,
        uploadedAt: Date.now(),
      };
      writeState();
      changed += 1;
      console.log(`[web-sync] hochgeladen: ${fileName}`);
    }

    if (changed === 0) console.log("[web-sync] keine Änderungen");
  } catch (error) {
    console.error(`[web-sync] Fehler: ${error.message || error}`);
    if (runOnce) process.exitCode = 1;
  } finally {
    running = false;
  }
}

async function main() {
  console.log(`[web-sync] Ziel: ftps://${host}${remoteDir}/`);
  console.log(`[web-sync] Datenordner: ${DATA_DIR}`);
  console.log(`[web-sync] Dateien: ${files.join(", ")}`);

  await syncOnce();
  if (runOnce) return;

  console.log(`[web-sync] prüft alle ${intervalSeconds} Sekunden auf Änderungen`);
  const timer = setInterval(() => {
    syncOnce().catch((error) => console.error(`[web-sync] Fehler: ${error.message || error}`));
  }, intervalSeconds * 1000);
  timer.unref();

  const shutdown = (signal) => {
    stopped = true;
    clearInterval(timer);
    console.log(`[web-sync] ${signal}: beendet`);
    setTimeout(() => process.exit(0), 100);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(`[web-sync] Start fehlgeschlagen: ${error.message || error}`);
  process.exit(1);
});
