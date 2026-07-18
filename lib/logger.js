const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "debug.log");

function ts() {
  return new Date().toISOString();
}

function serialize(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function log(...args) {
  const line = `[${ts()}] ${args.map(serialize).join(" ")}\n`;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch {}
}

function err(...args) {
  log("ERROR", ...args);
}

module.exports = { log, err, LOG_FILE };
