const crypto = require("crypto");
const ranked = require("./ranked");
const battleLab = require("../widget/battle-lab.js");

const LAB_IDS = Object.keys(battleLab.SPECIES);

function pairOldest(queue, joiningUserId) {
  const own = queue.entries?.[String(joiningUserId)];
  if (!own) return null;
  const opponent = Object.values(queue.entries || {})
    .filter((entry) => String(entry.userId) !== String(joiningUserId) && entry.status !== "battling")
    .sort((a, b) => Number(a.joinedAt || 0) - Number(b.joinedAt || 0))[0];
  return opponent ? [opponent, own] : null;
}

function battleId(mon) {
  const exact = LAB_IDS.find((id) => Number(battleLab.SPECIES[id].dexId) === Number(mon?.dexId));
  if (exact) return exact;
  return LAB_IDS[Math.abs(Number(mon?.dexId || mon?.caughtAt || 0)) % LAB_IDS.length];
}

function startIfReady({ queue, joiningUserId, profiles, now = Date.now() }) {
  const pair = pairOldest(queue, joiningUserId);
  if (!pair) return null;
  const [a, b] = pair;
  const seed = parseInt(crypto.createHash("sha256").update(`${a.userId}:${b.userId}:${now}`).digest("hex").slice(0, 8), 16);
  const simulation = battleLab.simulate({ seed, teamA:a.team.map(battleId), teamB:b.team.map(battleId) });
  const winnerIndex = simulation.winner == null ? seed % 2 : simulation.winner;
  const winner = pair[winnerIndex], loser = pair[winnerIndex ? 0 : 1];
  const match = {
    version:1, id:`ranked-${now}-${a.userId}-${b.userId}`, createdAt:now, seed,
    players:pair.map((entry) => ({ userId:String(entry.userId), display:entry.display, team:entry.team })),
    battleTeams:pair.map((entry) => entry.team.map(battleId)),
    winnerUserId:String(winner.userId), winnerDisplay:winner.display, loserUserId:String(loser.userId),
    lp:{ winner:20, loser:-15 }, simulation,
  };
  queue.entries[String(a.userId)].status = "battling";
  queue.entries[String(a.userId)].battleId = match.id;
  queue.entries[String(b.userId)].status = "battling";
  queue.entries[String(b.userId)].battleId = match.id;
  return match;
}

function finalize(match, profiles) {
  profiles.users ??= {};
  const winnerProfile = profiles.users[String(match.winnerUserId)];
  const loserProfile = profiles.users[String(match.loserUserId)];
  if (!winnerProfile || !loserProfile) throw new Error("Ranked-Profil fehlt beim Matchabschluss");
  winnerProfile.ranked = ranked.applyResult(winnerProfile.ranked, { won:true, lpChange:20, mmrChange:15 }).rank;
  loserProfile.ranked = ranked.applyResult(loserProfile.ranked, { won:false, lpChange:15, mmrChange:-15 }).rank;
  winnerProfile.stats ??= {}; loserProfile.stats ??= {};
  winnerProfile.stats.pvpBattles = Number(winnerProfile.stats.pvpBattles || 0) + 1;
  loserProfile.stats.pvpBattles = Number(loserProfile.stats.pvpBattles || 0) + 1;
  return profiles;
}

module.exports = { pairOldest, battleId, startIfReady, finalize };
