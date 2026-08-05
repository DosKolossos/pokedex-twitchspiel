const assert = require("assert/strict");
const { applyResult } = require("../lib/ranked");

let result = applyResult({ divisionIndex:2, lp:4 }, { won:false, lpChange:18 });
assert.equal(result.rank.division, "Silber");
assert.equal(result.rank.lp, 0);
assert.equal(result.demoted, false);

result = applyResult(result.rank, { won:false, lpChange:18 });
assert.equal(result.rank.division, "Bronze");
assert.equal(result.rank.lp, 50);
assert.equal(result.demoted, true);

result = applyResult({ divisionIndex:0, lp:0 }, { won:false, lpChange:30 });
assert.equal(result.rank.division, "Eisen");
assert.equal(result.rank.lp, 0);

result = applyResult({ divisionIndex:1, lp:95 }, { won:true, lpChange:12 });
assert.equal(result.rank.division, "Silber");
assert.equal(result.rank.lp, 7);
assert.equal(result.promoted, true);

result = applyResult({ divisionIndex:4, lp:95 }, { won:true, lpChange:12 });
assert.equal(result.rank.division, "Master");
assert.equal(result.rank.lp, 107);

console.log("Ranked-LP-Regeln erfolgreich getestet.");
