const DIVISIONS = ["Eisen", "Bronze", "Silber", "Gold", "Master"];

function normalizedRanked(value = {}) {
  const divisionIndex = Math.max(0, Math.min(DIVISIONS.length - 1,
    Number.isInteger(Number(value.divisionIndex)) ? Number(value.divisionIndex) : 0));
  return {
    divisionIndex,
    division: DIVISIONS[divisionIndex],
    lp: Math.max(0, Math.floor(Number(value.lp || 0))),
    wins: Math.max(0, Math.floor(Number(value.wins || 0))),
    losses: Math.max(0, Math.floor(Number(value.losses || 0))),
    games: Math.max(0, Math.floor(Number(value.games || 0))),
    mmr: Number.isFinite(Number(value.mmr)) ? Number(value.mmr) : 1000,
  };
}

function applyResult(current, { won, lpChange, mmrChange = 0 }) {
  const rank = normalizedRanked(current);
  const before = { ...rank };
  const amount = Math.max(0, Math.floor(Math.abs(Number(lpChange || 0))));
  let promoted = false;
  let demoted = false;

  rank.games += 1;
  rank.mmr += Number(mmrChange || 0);
  if (won) {
    rank.wins += 1;
    rank.lp += amount;
    while (rank.divisionIndex < DIVISIONS.length - 1 && rank.lp >= 100) {
      rank.lp -= 100;
      rank.divisionIndex += 1;
      promoted = true;
    }
  } else {
    rank.losses += 1;
    if (rank.lp > 0) {
      // Niederlagen innerhalb einer Division können nur bis 0 LP führen.
      rank.lp = Math.max(0, rank.lp - amount);
    } else if (rank.divisionIndex > 0) {
      // Nur eine Niederlage, die bereits bei 0 LP beginnt, löst den Abstieg aus.
      rank.divisionIndex -= 1;
      rank.lp = 50;
      demoted = true;
    } else {
      rank.lp = 0;
    }
  }

  rank.division = DIVISIONS[rank.divisionIndex];
  return { rank, before, promoted, demoted };
}

function leaderboard(profiles) {
  return Object.entries(profiles?.users || {})
    .map(([id, profile]) => ({ id, display:profile?.display || "Trainer", ...normalizedRanked(profile?.ranked) }))
    .filter((entry) => entry.games > 0)
    .sort((a, b) => b.divisionIndex - a.divisionIndex || b.lp - a.lp || b.mmr - a.mmr || b.wins - a.wins);
}

function publicRank(profiles, userId) {
  const list = leaderboard(profiles);
  const index = list.findIndex((entry) => String(entry.id) === String(userId));
  const own = normalizedRanked(profiles?.users?.[userId]?.ranked);
  return { ...own, position:index < 0 ? null : index + 1, total:list.length, placed:own.games > 0 };
}

module.exports = { DIVISIONS, normalizedRanked, applyResult, leaderboard, publicRank };
