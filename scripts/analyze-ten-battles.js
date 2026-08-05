const lab = require("../widget/battle-lab.js");

const scenarios = [
  ["Starter-Mix", ["pikachu","alakazam","machamp"], ["venusaur","charizard","blastoise"]],
  ["Pikachu gegen Wasser", ["pikachu","snorlax","venusaur"], ["blastoise","lapras","rhydon"]],
  ["Pikachu unter Druck", ["pikachu","charizard","lapras"], ["rhydon","gengar","machamp"]],
  ["Schnelle Angreifer", ["alakazam","jolteon","gengar"], ["charizard","dragonite","machamp"]],
  ["Langsame Kraft", ["snorlax","rhydon","machamp"], ["alakazam","gengar","lapras"]],
  ["Statusattacken", ["gengar","pikachu","charizard"], ["snorlax","venusaur","blastoise"]],
  ["Immunitäten", ["gengar","rhydon","charizard"], ["machamp","pikachu","alakazam"]],
  ["Defensive Teams", ["lapras","blastoise","snorlax"], ["venusaur","dragonite","rhydon"]],
  ["Typennachteil beim Start", ["charizard","pikachu","machamp"], ["blastoise","venusaur","alakazam"]],
  ["Gemischtes Finale", ["dragonite","pikachu","blastoise"], ["lapras","gengar","snorlax"]]
];

for (const [index,[name,teamA,teamB]] of scenarios.entries()) {
  const result=lab.simulate({seed:1001+index,teamA,teamB});
  console.log(`\n=== KAMPF ${index+1}: ${name} ===`);
  console.log(`Blau: ${teamA.map(id=>lab.SPECIES[id].name).join(", ")}`);
  console.log(`Rot:  ${teamB.map(id=>lab.SPECIES[id].name).join(", ")}`);
  for(const entry of result.log) console.log(entry.text);
  console.log(`Ergebnis: ${result.state[result.winner]?.name||"Unentschieden"} | Seed: ${result.seed}`);
}
