const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const userId = String(process.argv[2] || process.env.DEV_TWITCH_USER_ID || "").trim();

if (!/^\d+$/.test(userId)) {
  console.error("[widget-test] Bitte die numerische Twitch-ID angeben.");
  console.error("[widget-test] Beispiel: npm run widget:test -- 1037156693");
  process.exit(1);
}

const overlayPort = Number(process.env.OVERLAY_PORT || 3010);
const widgetPort = Number(process.env.WIDGET_DEV_PORT || 8080);
const devKey = crypto.randomBytes(32).toString("hex");
const commonEnv = {
  ...process.env,
  WIDGET_DEV_KEY: devKey,
  DEV_TWITCH_USER_ID: userId,
  OVERLAY_HOST: "127.0.0.1",
  OVERLAY_PORT: String(overlayPort),
  WIDGET_DEV_PORT: String(widgetPort),
  WIDGET_DEV_API_URL: `http://127.0.0.1:${overlayPort}`,
};

const children = [];

function start(label, script) {
  const child = spawn(process.execPath, [path.join(ROOT, script)], {
    cwd: ROOT,
    env: commonEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  child.on("exit", (code, signal) => {
    if (!shuttingDown && code !== 0) {
      console.error(`[widget-test] ${label} wurde unerwartet beendet (${signal || code}).`);
      shutdown(1);
    }
  });
  children.push(child);
}

let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(exitCode), 150).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("API", "overlay-server-v8.js");
setTimeout(() => {
  if (shuttingDown) return;
  start("WIDGET", "scripts/widget-dev-server.js");
  console.log("");
  console.log(`[widget-test] Öffne gleich: http://127.0.0.1:${widgetPort}`);
  console.log("[widget-test] Alle Änderungen betreffen nur die Dateien in diesem Projektordner.");
  console.log("[widget-test] Beenden mit Strg + C.");
  console.log("");
}, 350);
