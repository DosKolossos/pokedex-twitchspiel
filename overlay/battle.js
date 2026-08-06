(() => {
  const lab = window.PokeBattleLab;
  let scenario = { seed: 1004, teamA: ["alakazam", "jolteon", "gengar"], teamB: ["charizard", "dragonite", "machamp"] };
  let serverResult = null;
  let currentBattleId = null;
  let playerNames = ["Team Blau", "Team Rot"];
  const speed = Math.max(.25, Number(new URLSearchParams(location.search).get("speed")) || 1);
  const $ = (selector, root = document) => root.querySelector(selector);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms * speed));
  const dom = { left:$("#playerMon"),right:$("#enemyMon"),leftPanel:$("#playerPanel"),rightPanel:$("#enemyPanel"),leftTeam:$("#teamLeft"),rightTeam:$("#teamRight"),message:$("#message"),turn:$("#turn"),damage:$("#damage"),effect:$("#effect"),winner:$("#winner") };
  let token = 0;

  function makeMon(input, side, index) { const descriptor=typeof input==="object"&&input?input:{id:input},species=lab.SPECIES[descriptor.id],level=Math.max(1,Math.min(100,Number(descriptor.level||50))),stats=lab.stats(species.base,level,species.nature);return{id:descriptor.id,instanceId:String(descriptor.instanceId||`${side}:${index}`),side,index,name:descriptor.name||species.name,dexId:Number(descriptor.dexId||species.dexId),level,maxHp:stats.hp,hp:stats.hp,status:null,fainted:false}; }
  function freshTeams(){return[scenario.teamA.map((mon,i)=>makeMon(mon,0,i)),scenario.teamB.map((mon,i)=>makeMon(mon,1,i))];}
  function findMon(state,name,side){return state.teams.flat().find(mon=>mon.name===name&&(side==null||mon.side===side));}
  function active(state,side){return state.teams[side][state.active[side]];}
  function moveNamed(name){return Object.values(lab.MOVES).find(move=>move.name===name);}
  function installImage(img,local,fallback){img.onerror=()=>{if(img.src!==fallback)img.src=fallback;};img.src=local;}
  function sprite(mon,back){return`/sprites/${back?"back":"front"}/${mon.dexId}.gif`;}
  function spriteFallback(mon,back){return`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${back?"back/":""}${mon.dexId}.gif`;}

  function eventsFrom(result){
    const state={teams:freshTeams(),active:[0,0]},events=[{type:"message",text:`${playerNames[0]} fordert ${playerNames[1]} heraus!`}];
    for(const entry of result.log){const text=entry.text;let m;
      if(/^Zug \d+$/.test(text)){events.push({type:"turn",turn:entry.turn});continue;}
      if((m=text.match(/^(Team Blau|Team Rot) schickt (.+?) in den Kampf/))){const side=m[1]==="Team Blau"?0:1,to=findMon(state,m[2],side);if(to){state.active[side]=to.index;events.push({type:"switch",side,to:{...to},text});}continue;}
      if((m=text.match(/^(.+?) wird gegen (.+?) ausgewechselt/))){const from=[active(state,0),active(state,1)].find(mon=>mon.name===m[1]),to=from&&findMon(state,m[2],from.side);if(from&&to){state.active[from.side]=to.index;events.push({type:"switch",side:from.side,to:{...to},text});}continue;}
      if((m=text.match(/^(.+?) setzt (.+?) ein: (\d+) Schaden(.*)$/))){const attacker=[active(state,0),active(state,1)].find(mon=>mon.name===m[1]&&mon.hp>0);if(attacker){const defender=active(state,attacker.side?0:1),amount=Number(m[3]),before=defender.hp;defender.hp=Math.max(0,before-amount);events.push({type:"move",side:attacker.side,attacker:{...attacker},defender:{...defender},move:moveNamed(m[2]),amount,before,after:defender.hp,text,effectiveness:m[4]});}continue;}
      if((m=text.match(/^(.+?) setzt (.+?) ein und heilt (\d+) KP/))){const mon=findMon(state,m[1]);if(mon){mon.hp=Math.min(mon.maxHp,mon.hp+Number(m[3]));events.push({type:"heal",mon:{...mon},text});}continue;}
      if((m=text.match(/^(.+?) setzt (.+?) ein[. –]+(.+?) wird (verbrannt|paralysiert)/))){const target=findMon(state,m[3]);if(target){target.status=m[4]==="verbrannt"?"burned":"paralyzed";events.push({type:"status",target:{...target},text});}continue;}
      if((m=text.match(/^(.+?) erleidet (\d+) Verbrennungsschaden/))){const mon=findMon(state,m[1]);if(mon){const amount=Number(m[2]);mon.hp=Math.max(0,mon.hp-amount);events.push({type:"damage",mon:{...mon},amount,text});}continue;}
      if((m=text.match(/^(.+?) ist kampfunfähig/))){const mon=findMon(state,m[1]);if(mon){mon.fainted=true;mon.hp=0;events.push({type:"faint",mon:{...mon},text});}continue;}
      if(text.includes("geht daneben")||text.includes("keine Wirkung")||text.includes("Angriff steigt"))events.push({type:"message",text});
    }
    events.push({type:"winner",text:result.winner==null?"Unentschieden":`${playerNames[result.winner]} gewinnt!`});return events;
  }

  function renderTeam(state,side){const root=side?dom.rightTeam:dom.leftTeam;root.innerHTML="";state.teams[side].forEach(mon=>{const slot=document.createElement("div");slot.className=`team-slot${state.active[side]===mon.index?" active":""}${mon.fainted?" fainted":""}`;const img=document.createElement("img");installImage(img,`/sprites/icons/${mon.dexId}.png`,`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${mon.dexId}.png`);slot.append(img);root.append(slot);});}
  function renderPanel(panel,mon,exact){const ratio=Math.max(0,mon.hp/mon.maxHp),fill=$("[data-fill]",panel);$("[data-name]",panel).textContent=`${mon.name} · Lv. ${mon.level}`;$("[data-percent]",panel).textContent=`${Math.ceil(ratio*100)} %`;fill.style.width=`${ratio*100}%`;fill.classList.toggle("medium",ratio<=.5&&ratio>.2);fill.classList.toggle("low",ratio<=.2);const badge=$("[data-status]",panel);badge.hidden=!mon.status;badge.className=`status ${mon.status||""}`;badge.textContent=mon.status==="burned"?"BRN":mon.status==="paralyzed"?"PAR":"";const hp=$("[data-exact]",panel);if(hp)hp.textContent=exact?`${mon.hp} / ${mon.maxHp} KP`:"";}
  function playEntry(box,side){
    box.getAnimations().forEach((animation)=>animation.cancel());
    box.animate(
      [
        {transform:`translateX(${side?110:-110}px) scale(.7)`},
        {transform:"translateX(0) scale(1)"}
      ],
      {duration:520,easing:"ease-out"}
    );
  }
  function renderActive(state,side,enter=false){const mon=active(state,side),box=side?dom.right:dom.left,panel=side?dom.rightPanel:dom.leftPanel,img=$("img",box);box.style.opacity="";box.className=`combatant combatant-${side?"enemy":"player"}`;installImage(img,sprite(mon,!side),spriteFallback(mon,!side));renderPanel(panel,mon,!side);if(enter)playEntry(box,side);renderTeam(state,side);}
  function damagePop(mon,amount,label=""){dom.damage.className=`damage-pop ${mon.side?"enemy":"player"}`;dom.damage.innerHTML=`−${Math.max(1,Math.round(amount/mon.maxHp*100))} %${label?`<small>${label}</small>`:""}`;void dom.damage.offsetWidth;dom.damage.classList.add("show");}
  async function playMove(state,event){const attackerBox=event.side?dom.right:dom.left,defenderBox=event.side?dom.left:dom.right;dom.message.textContent=`${event.attacker.name} setzt ${event.move?.name||"eine Attacke"} ein!`;attackerBox.classList.add(event.side?"attack-right":"attack-left");dom.effect.className=`move-effect ${event.move?.type||"normal"} ${event.side?"to-player":"to-enemy"}`;await sleep(460);const defender=findMon(state,event.defender.name);defender.hp=event.after;defenderBox.classList.add("hit");damagePop(defender,event.amount,event.effectiveness.includes("sehr effektiv")?"SEHR EFFEKTIV":"");renderPanel(defender.side?dom.rightPanel:dom.leftPanel,defender,!defender.side);await sleep(780);attackerBox.classList.remove("attack-left","attack-right");defenderBox.classList.remove("hit");}

  async function loadRankedBattle(){try{const response=await fetch("/api/ranked-battle",{cache:"no-store"});if(!response.ok)return false;const battle=await response.json();if(!battle?.id||!battle?.simulation)return false;currentBattleId=battle.id;scenario={seed:battle.seed,teamA:battle.battleTeams?.[0]||scenario.teamA,teamB:battle.battleTeams?.[1]||scenario.teamB};playerNames=[battle.players?.[0]?.display||"Team Blau",battle.players?.[1]?.display||"Team Rot"];serverResult=battle.simulation;return true;}catch(error){console.warn("Ranked-Kampf konnte nicht geladen werden",error);return false;}}
  async function completeRankedBattle(){if(!currentBattleId)return;try{await fetch(`/api/ranked-battle/${encodeURIComponent(currentBattleId)}/complete`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});}catch(error){console.warn("Kampfabschluss konnte nicht bestätigt werden",error);}}
  async function run(){const found=await loadRankedBattle();if(!found){dom.message.textContent="Warte auf den nächsten Ranked-Kampf …";dom.turn.textContent="BEREIT";setTimeout(run,2000);return;}const runToken=++token,result=serverResult,events=eventsFrom(result),state={teams:freshTeams(),active:[0,0]};dom.winner.hidden=true;dom.turn.textContent="KAMPFBEGINN";renderActive(state,0,true);renderActive(state,1,true);await sleep(700);
    for(const event of events){if(runToken!==token)return;
      if(event.type==="turn"){dom.turn.textContent=`ZUG ${event.turn}`;await sleep(320);}
      else if(event.type==="switch"){dom.message.textContent=event.text;const old=event.side?dom.right:dom.left;old.style.opacity="0";await sleep(320);state.active[event.side]=event.to.index;renderActive(state,event.side,true);await sleep(650);}
      else if(event.type==="move")await playMove(state,event);
      else if(event.type==="damage"){const mon=findMon(state,event.mon.name);mon.hp=event.mon.hp;dom.message.textContent=event.text;damagePop(mon,event.amount);renderPanel(mon.side?dom.rightPanel:dom.leftPanel,mon,!mon.side);await sleep(800);}
      else if(event.type==="heal"||event.type==="status"){const source=event.mon||event.target,mon=findMon(state,source.name);Object.assign(mon,{hp:source.hp,status:source.status});dom.message.textContent=event.text;renderPanel(mon.side?dom.rightPanel:dom.leftPanel,mon,!mon.side);await sleep(850);}
      else if(event.type==="faint"){const mon=findMon(state,event.mon.name);mon.fainted=true;mon.hp=0;dom.message.textContent=event.text;(mon.side?dom.right:dom.left).classList.add("faint");renderPanel(mon.side?dom.rightPanel:dom.leftPanel,mon,!mon.side);renderTeam(state,mon.side);await sleep(900);}
      else if(event.type==="message"){dom.message.textContent=event.text;await sleep(800);}
      else if(event.type==="winner"){dom.winner.textContent=event.text;dom.winner.hidden=false;await sleep(1200);}
    }
    if(runToken===token){await completeRankedBattle();currentBattleId=null;serverResult=null;setTimeout(run,2000);}
  }
  $("#replay").addEventListener("click",()=>{if(!currentBattleId)run();});run();
})();
