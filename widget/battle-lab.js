(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PokeBattleLab = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const NATURES = {
    hardy:["Robust",null,null], lonely:["Solo","attack","defense"], brave:["Mutig","attack","speed"], adamant:["Hart","attack","specialAttack"], naughty:["Frech","attack","specialDefense"],
    bold:["Kühn","defense","attack"], docile:["Sanft",null,null], relaxed:["Locker","defense","speed"], impish:["Pfiffig","defense","specialAttack"], lax:["Lasch","defense","specialDefense"],
    timid:["Scheu","speed","attack"], hasty:["Hastig","speed","defense"], serious:["Ernst",null,null], jolly:["Froh","speed","specialAttack"], naive:["Naiv","speed","specialDefense"],
    modest:["Mäßig","specialAttack","attack"], mild:["Mild","specialAttack","defense"], quiet:["Ruhig","specialAttack","speed"], bashful:["Zaghaft",null,null], rash:["Hitzig","specialAttack","specialDefense"],
    calm:["Still","specialDefense","attack"], gentle:["Zart","specialDefense","defense"], sassy:["Forsch","specialDefense","speed"], careful:["Sacht","specialDefense","specialAttack"], quirky:["Kauzig",null,null]
  };
  const TYPE = {
    normal:{rock:.5,ghost:0},fire:{fire:.5,water:.5,grass:2,ice:2,bug:2,rock:.5,dragon:.5},water:{fire:2,water:.5,grass:.5,ground:2,rock:2,dragon:.5},
    electric:{water:2,electric:.5,grass:.5,ground:0,flying:2,dragon:.5},grass:{fire:.5,water:2,grass:.5,poison:.5,ground:2,flying:.5,bug:.5,rock:2,dragon:.5},
    ice:{fire:.5,water:.5,grass:2,ice:.5,ground:2,flying:2,dragon:2},fighting:{normal:2,ice:2,poison:.5,flying:.5,psychic:.5,bug:.5,rock:2,ghost:0},
    poison:{grass:2,poison:.5,ground:.5,rock:.5,ghost:.5},ground:{fire:2,electric:2,grass:.5,poison:2,flying:0,bug:.5,rock:2},flying:{electric:.5,grass:2,fighting:2,bug:2,rock:.5},
    psychic:{fighting:2,poison:2,psychic:.5},bug:{fire:.5,grass:2,fighting:.5,poison:.5,flying:.5,psychic:2,ghost:.5},rock:{fire:2,ice:2,fighting:.5,ground:.5,flying:2,bug:2},
    ghost:{normal:0,psychic:2,ghost:2},dragon:{dragon:2}
  };
  const MOVES = {
    flamethrower:{name:"Flammenwurf",type:"fire",power:90,accuracy:100,category:"special",burn:.1}, airSlash:{name:"Luftschnitt",type:"flying",power:75,accuracy:95,category:"special"},
    surf:{name:"Surfer",type:"water",power:90,accuracy:100,category:"special"}, iceBeam:{name:"Eisstrahl",type:"ice",power:90,accuracy:100,category:"special"},
    thunderbolt:{name:"Donnerblitz",type:"electric",power:90,accuracy:100,category:"special"}, psychic:{name:"Psychokinese",type:"psychic",power:90,accuracy:100,category:"special"},
    shadowBall:{name:"Spukball",type:"ghost",power:80,accuracy:100,category:"special"}, sludgeBomb:{name:"Matschbombe",type:"poison",power:90,accuracy:100,category:"special"},
    earthquake:{name:"Erdbeben",type:"ground",power:100,accuracy:100,category:"physical"}, rockSlide:{name:"Steinhagel",type:"rock",power:75,accuracy:90,category:"physical"},
    bodySlam:{name:"Bodyslam",type:"normal",power:85,accuracy:100,category:"physical"}, dragonClaw:{name:"Drachenklaue",type:"dragon",power:80,accuracy:100,category:"physical"},
    closeCombat:{name:"Nahkampf",type:"fighting",power:120,accuracy:100,category:"physical"}, razorLeaf:{name:"Rasierblatt",type:"grass",power:55,accuracy:95,category:"physical"},
    recover:{name:"Genesung",type:"normal",category:"status",heal:.5}, thunderWave:{name:"Donnerwelle",type:"electric",category:"status",status:"paralyzed",accuracy:90},
    willOWisp:{name:"Irrlicht",type:"fire",category:"status",status:"burned",accuracy:85}, swordsDance:{name:"Schwerttanz",type:"normal",category:"status",boost:{attack:2}}
  };
  const SPECIES = {
    venusaur:{name:"Bisaflor",dexId:3,types:["grass","poison"],base:[80,82,83,100,100,80],nature:"calm",moves:["razorLeaf","sludgeBomb","earthquake"]},
    charizard:{name:"Glurak",dexId:6,types:["fire","flying"],base:[78,84,78,109,85,100],nature:"timid",moves:["flamethrower","airSlash","willOWisp"]},
    blastoise:{name:"Turtok",dexId:9,types:["water"],base:[79,83,100,85,105,78],nature:"modest",moves:["surf","iceBeam"]},
    pikachu:{name:"Pikachu",dexId:25,types:["electric"],base:[35,55,40,50,50,90],nature:"timid",moves:["thunderbolt","thunderWave"]},
    alakazam:{name:"Simsala",dexId:65,types:["psychic"],base:[55,50,45,135,95,120],nature:"timid",moves:["psychic","shadowBall","recover"]},
    machamp:{name:"Machomei",dexId:68,types:["fighting"],base:[90,130,80,65,85,55],nature:"adamant",moves:["closeCombat","rockSlide","earthquake"]},
    gengar:{name:"Gengar",dexId:94,types:["ghost","poison"],base:[60,65,60,130,75,110],nature:"timid",moves:["shadowBall","sludgeBomb","thunderbolt","willOWisp"]},
    rhydon:{name:"Rizeros",dexId:112,types:["ground","rock"],base:[105,130,120,45,45,40],nature:"adamant",moves:["earthquake","rockSlide"]},
    lapras:{name:"Lapras",dexId:131,types:["water","ice"],base:[130,85,80,85,95,60],nature:"calm",moves:["surf","iceBeam","thunderbolt"]},
    snorlax:{name:"Relaxo",dexId:143,types:["normal"],base:[160,110,65,65,110,30],nature:"careful",moves:["bodySlam","earthquake"]},
    jolteon:{name:"Blitza",dexId:135,types:["electric"],base:[65,65,60,110,95,130],nature:"timid",moves:["thunderbolt","shadowBall","thunderWave"]},
    dragonite:{name:"Dragoran",dexId:149,types:["dragon","flying"],base:[91,134,95,100,100,80],nature:"adamant",moves:["dragonClaw","earthquake","rockSlide","swordsDance"]}
  };
  function stats(base, level, natureId) {
    const keys=["hp","attack","defense","specialAttack","specialDefense","speed"], n=NATURES[natureId]||NATURES.hardy;
    return Object.fromEntries(keys.map((k,i)=>{
      if(k==="hp") return [k,Math.floor(((2*base[i]+31)*level)/100)+level+10];
      const multiplier=n[1]===k?1.1:(n[2]===k?0.9:1);
      return [k,Math.floor((Math.floor(((2*base[i]+31)*level)/100)+5)*multiplier)];
    }));
  }
  function effectiveness(type, types) { return types.reduce((v,t)=>v*(TYPE[type]?.[t]??1),1); }
  function seeded(seed=1){let x=seed>>>0;return()=>((x=(x*1664525+1013904223)>>>0)/4294967296);}
  function makeMon(id, level=50){const s=SPECIES[id], st=stats(s.base,level,s.nature);return{id,...s,level,stats:st,hp:st.hp,status:null,stages:{attack:0},moves:s.moves.map(x=>MOVES[x])};}
  function expectedDamage(a,d,m){if(!m.power)return 0;const atk=m.category==="physical"?a.stats.attack:a.stats.specialAttack,def=m.category==="physical"?d.stats.defense:d.stats.specialDefense;return Math.floor((((2*a.level/5+2)*m.power*atk/def)/50+2)*(a.types.includes(m.type)?1.5:1)*effectiveness(m.type,d.types)*(m.accuracy||100)/100);}
  function scoreMove(a,d,m){if(m.power)return expectedDamage(a,d,m)+(expectedDamage(a,d,m)>=d.hp?1000:0);if(m.heal)return a.hp/a.stats.hp<.48?70:2;if(m.status)return d.status?0:35;if(m.boost)return a.stages.attack<2?30:3;return 0;}
  function choose(state,side){const own=state[side],enemy=state[side?0:1],a=own.team[own.active],d=enemy.team[enemy.active];let best={kind:"move",index:0,score:-1};a.moves.forEach((m,i)=>{const score=scoreMove(a,d,m);if(score>best.score)best={kind:"move",index:i,score};});own.team.forEach((mon,i)=>{if(i===own.active||mon.hp<=0)return;const attack=Math.max(...mon.moves.map(m=>expectedDamage(mon,d,m)));const incoming=Math.max(...d.moves.map(m=>expectedDamage(d,mon,m)));const score=attack-incoming*.35-18;if(score>best.score+16)best={kind:"switch",index:i,score};});return best;}
  function firstAlive(side){return side.team.findIndex(m=>m.hp>0);}
  function simulate(options={}){const random=seeded(Number(options.seed)||2026), ids=Object.keys(SPECIES), aIds=options.teamA||ids.slice(0,3),bIds=options.teamB||ids.slice(3,6),state=[{name:"Team Blau",team:aIds.map(x=>makeMon(x)),active:0},{name:"Team Rot",team:bIds.map(x=>makeMon(x)),active:0}],log=[];for(let turn=1;turn<=100;turn++){if(firstAlive(state[0])<0||firstAlive(state[1])<0)break;const actions=[choose(state,0),choose(state,1)];const order=[0,1].sort((x,y)=>{if(actions[x].kind==="switch"&&actions[y].kind!=="switch")return-1;if(actions[y].kind==="switch"&&actions[x].kind!=="switch")return 1;return state[y].team[state[y].active].stats.speed-state[x].team[state[x].active].stats.speed;});log.push({turn,text:`Zug ${turn}`});for(const side of order){const own=state[side],enemy=state[side?0:1];if(firstAlive(own)<0||firstAlive(enemy)<0)continue;let a=own.team[own.active];if(a.hp<=0){own.active=firstAlive(own);a=own.team[own.active];log.push({turn,side,text:`${own.name} schickt ${a.name} in den Kampf.`});continue;}const action=actions[side];if(action.kind==="switch"&&own.team[action.index]?.hp>0){const old=a;own.active=action.index;a=own.team[own.active];log.push({turn,side,text:`${old.name} wird gegen ${a.name} ausgewechselt (bessere erwartete Wirkung).`});continue;}const d=enemy.team[enemy.active],m=a.moves[action.index]||a.moves[0];if(random()*100>(m.accuracy||100)){log.push({turn,text:`${a.name}s ${m.name} geht daneben.`});continue;}if(m.heal){const amount=Math.min(a.stats.hp-a.hp,Math.floor(a.stats.hp*m.heal));a.hp+=amount;log.push({turn,text:`${a.name} setzt ${m.name} ein und heilt ${amount} KP.`});continue;}if(m.status){if(!d.status){d.status=m.status;log.push({turn,text:`${a.name} setzt ${m.name} ein. ${d.name} wird ${m.status==="burned"?"verbrannt":"paralysiert"}.`});}continue;}if(m.boost){a.stages.attack=Math.min(6,a.stages.attack+2);a.stats.attack=Math.floor(a.stats.attack*1.5);log.push({turn,text:`${a.name} setzt ${m.name} ein. Angriff steigt stark.`});continue;}const eff=effectiveness(m.type,d.types),variance=.85+random()*.15,damage=Math.max(1,Math.floor(expectedDamage(a,d,{...m,accuracy:100})*variance));d.hp=Math.max(0,d.hp-damage);log.push({turn,text:`${a.name} setzt ${m.name} ein: ${damage} Schaden${eff>1?" – sehr effektiv!":eff<1?" – nicht sehr effektiv.":"."}`});if(d.hp===0)log.push({turn,text:`${d.name} ist kampfunfähig!`});}for(const side of state){for(const m of side.team){if(m.hp>0&&m.status==="burned"){const dot=Math.max(1,Math.floor(m.stats.hp/16));m.hp=Math.max(0,m.hp-dot);log.push({turn,text:`${m.name} erleidet ${dot} Verbrennungsschaden.`});}}}}const winner=firstAlive(state[0])>=0?0:1;return{state,log,winner,seed:Number(options.seed)||2026};}
  return {NATURES,MOVES,SPECIES,stats,effectiveness,simulate};
});
