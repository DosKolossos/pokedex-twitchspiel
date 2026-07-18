// local/lib/dex.js
const paths = require("./paths");
const { readJsonSafe, writeText } = require("./fileStore");
const { log } = require("./logger");

function fmtDate(ts) {
  if (!ts) return "-";
  try { return new Date(ts).toLocaleString("de-DE"); } catch { return String(ts); }
}

function uniqueKey(p) {
  return (p && p.dexId != null)
    ? `dex:${p.dexId}`
    : `name:${String(p?.name || p?.displayName || "?").toLowerCase()}`;
}

function normalizeDexHistoryList(user) {
  const history = Array.isArray(user?.dexHistory) ? user.dexHistory : [];
  const currentCaught = Array.isArray(user?.caught) ? user.caught : [];

  if (!history.length && currentCaught.length) {
    const seen = new Set();
    const derived = [];
    for (const p of currentCaught) {
      const key = uniqueKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      derived.push({
        dexId: p?.dexId ?? null,
        name: p?.name || p?.displayName || "?",
        firstOwnedAt: p?.caughtAt || Date.now(),
        lastOwnedAt: p?.caughtAt || Date.now(),
        via: "derived_current",
      });
    }
    return derived;
  }

  return history;
}

function handleDex({ userId, userName }) {
  const uid = String(userId || "").trim();
  const uname = String(userName || "").trim();
  if (!uid) return;

  const pokedex = readJsonSafe(paths.POKEDEX_JSON, { users: {} });
  const user = pokedex.users?.[uid];

  if (!user || !Array.isArray(user.caught)) {
    const msg = `@${uname || "User"} Dex: 0 einzigartig | Im Besitz: 0 | Catches: 0`;
    writeText(paths.dexMessageFile(uid), msg);
    log(`dex empty uid=${uid}`);
    return;
  }

  const caught = user.caught;
  const history = normalizeDexHistoryList(user);
  const uniqueCurrent = new Set(caught.map(uniqueKey));
  const uniqueHistorical = new Set(history.map((h) =>
    h && h.dexId != null ? `dex:${h.dexId}` : `name:${String(h?.name || "?").toLowerCase()}`
  ));

  const last5 = [...caught]
    .slice(-5)
    .reverse()
    .map((p) => {
      const name = p?.displayName || p?.name || "?";
      const rarity = (p?.rarity || "").toUpperCase();
      const id = p?.dexId != null ? `#${p.dexId}` : "?";
      return `${name} ${rarity ? `(${rarity})` : ""} ${id} @ ${fmtDate(p?.caughtAt)}`;
    });

  const msg =
    `@${uname || "User"} Dex: ${uniqueHistorical.size} einzigartig | ` +
    `Im Besitz: ${uniqueCurrent.size} | Catches: ${caught.length}` +
    (last5.length ? ` | Letzte: ${last5.join(" | ")}` : "");

  writeText(paths.dexMessageFile(uid), msg);
  log(`dex ok uid=${uid} hist=${uniqueHistorical.size} current=${uniqueCurrent.size} total=${caught.length}`);
}

module.exports = { handleDex };
