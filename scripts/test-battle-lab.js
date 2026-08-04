const assert = require("assert");
const lab = require("../widget/battle-lab.js");
const natures = require("../lib/natures");

assert.equal(natures.parseNature("Mäßig").id, "modest");
assert.equal(natures.parseNature("massig").id, "modest");
assert.equal(natures.parseNature("ADAMANT").id, "adamant");
assert.equal(natures.calculateStats({hp:78,attack:84,defense:78,specialAttack:109,specialDefense:85,speed:100},50,"timid").speed, 132);
assert.equal(lab.effectiveness("electric",["ground"]),0);
const first=lab.simulate({seed:42}), second=lab.simulate({seed:42});
assert.deepEqual(first.log,second.log);
assert.ok(first.log.some((entry)=>entry.text.includes("Schaden")));
assert.ok(first.log.length<500);
console.log("Wesen, Statuswerte, Typen und reproduzierbare 3-gegen-3-Simulation: OK");
