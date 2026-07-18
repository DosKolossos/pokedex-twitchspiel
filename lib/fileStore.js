const fs = require("fs");
const path = require("path");
const { DATA_DIR, OUT_DIR } = require("./paths");
const { log, err } = require("./logger");

function ensureDirs() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
  } catch (e) {
    err("ensureDirs failed", e?.message || String(e));
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    err("readJson failed", file, e?.message || String(e));
    return fallback;
  }
}

function atomicWrite(file, contents) {
  ensureDirs();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temp, contents, "utf8");
  fs.renameSync(temp, file);
}

function writeJson(file, data) {
  try {
    atomicWrite(file, JSON.stringify(data, null, 2));
  } catch (e) {
    err("writeJson failed", file, e?.message || String(e));
    throw e;
  }
}

function writeText(file, text) {
  try {
    atomicWrite(file, String(text ?? ""));
    log("writeText", path.basename(file), "len=", String(text ?? "").length);
  } catch (e) {
    err("writeText failed", file, e?.message || String(e));
    throw e;
  }
}

function readText(file, fallback = "") {
  try {
    if (!fs.existsSync(file)) return fallback;
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    err("readText failed", file, e?.message || String(e));
    return fallback;
  }
}

function readJsonSafe(file, fallback) {
  return readJson(file, fallback);
}

module.exports = {
  ensureDirs,
  readJson,
  readJsonSafe,
  readText,
  writeJson,
  writeText,
};
