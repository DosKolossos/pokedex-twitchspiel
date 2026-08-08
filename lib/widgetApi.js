const fs = require("fs");
const evo = require("./evo");
const ranked = require("./ranked");
const rankedQueue = require("./rankedQueue");
const trade = require("./trade");

function installWidgetApi(app, { paths, readJsonSafe, setNoCache }) {
  const recentPlayerIds = (userId) => {
    const presence = readJsonSafe(paths.CHAT_PRESENCE_JSON, { users:{} });
    return new Set(Object.values(presence.users || {})
      .filter((entry) => String(entry?.id) !== String(userId) && Date.now() - Number(entry?.lastSeenAt || 0) <= 30 * 60 * 1000)
      .map((entry) => String(entry.id)));
  };

  app.get("/api/widget/meta", (req, res) => {
    setNoCache(res);
    const userId = req.twitchUserId;
    const pokedex = readJsonSafe(paths.POKEDEX_JSON, { users:{} });
    const profiles = readJsonSafe(paths.PROFILES_JSON, { users:{} });
    const presence = readJsonSafe(paths.CHAT_PRESENCE_JSON, { users:{} });
    const rows = Object.entries(pokedex.users || {}).map(([id, entry]) => {
      const mons = Array.isArray(entry?.caught) ? entry.caught : [];
      return { id, catches:mons.length, distinct:new Set(mons.map((mon) => mon?.dexId ?? mon?.name)).size, battles:Number(profiles.users?.[id]?.stats?.pvpBattles || 0) };
    });
    const rank = (field) => { const list=[...rows].sort((a,b)=>b[field]-a[field]); const i=list.findIndex((row)=>String(row.id)===userId); return { rank:i<0?null:i+1,total:list.length,value:i<0?0:list[i][field] }; };
    const queue = rankedQueue.readQueue(paths.RANKED_QUEUE_JSON, readJsonSafe);
    res.json({ ok:true, ranks:{ catches:rank("catches"),distinct:rank("distinct"),battles:rank("battles") }, ranked:ranked.publicRank(profiles,userId), rankedQueue:rankedQueue.publicEntry(queue,userId), availablePlayers:Object.values(presence.users || {}).filter((entry)=>String(entry?.id)!==userId && Date.now()-Number(entry?.lastSeenAt||0)<=30*60*1000) });
  });

  app.post("/api/widget/ranked/queue", (req, res) => {
    setNoCache(res);
    const userId = req.twitchUserId;
    const intent = String(req.body?.intent || "");
    const profiles = readJsonSafe(paths.PROFILES_JSON, { users:{} });
    const profile = profiles.users?.[userId];
    if (!profile) return res.status(404).json({ ok:false, error:"player_not_found" });
    const queue = rankedQueue.readQueue(paths.RANKED_QUEUE_JSON, readJsonSafe);
    if (intent === "leave") {
      delete queue.entries[userId];
      rankedQueue.writeQueue(paths.RANKED_QUEUE_JSON, queue);
      return res.json({ ok:true, rankedQueue:rankedQueue.publicEntry(queue,userId) });
    }
    if (intent !== "join") return res.status(400).json({ ok:false, error:"invalid_intent" });
    if (queue.entries[userId]) return res.status(409).json({ ok:false, error:"already_queued" });
    const caughtAts = [...new Set((req.body?.caughtAts || []).map(Number).filter(Boolean))];
    if (caughtAts.length !== 3) return res.status(400).json({ ok:false, error:"select_exactly_three" });
    const snapshot = rankedQueue.snapshotTeam(profile, caughtAts);
    if (snapshot.length !== 3) return res.status(409).json({ ok:false, error:"team_changed" });
    queue.entries[userId] = { userId, display:profile.display || "Trainer", joinedAt:Date.now(), team:snapshot };
    rankedQueue.writeQueue(paths.RANKED_QUEUE_JSON, queue);
    return res.json({ ok:true, rankedQueue:rankedQueue.publicEntry(queue,userId) });
  });

  app.get("/api/widget/trade/player/:id", (req, res) => {
    setNoCache(res);
    const userId = String(req.twitchUserId);
    const targetId = String(req.params.id || "");
    if (!recentPlayerIds(userId).has(targetId)) return res.status(404).json({ ok:false, error:"player_not_available" });
    const pokedex = readJsonSafe(paths.POKEDEX_JSON, { users:{} });
    const target = pokedex.users?.[targetId];
    if (!target) return res.status(404).json({ ok:false, error:"player_not_found" });
    const queue = rankedQueue.readQueue(paths.RANKED_QUEUE_JSON, readJsonSafe);
    return res.json({
      ok:true,
      player:{ id:targetId, display:target.display || "Trainer" },
      caught:(Array.isArray(target.caught) ? target.caught : []).map((mon) => ({
        caughtAt:Number(mon?.caughtAt || 0), name:mon?.name, displayName:mon?.displayName,
        dexId:mon?.dexId ?? null, spriteUrl:mon?.spriteUrl ?? null, rarity:mon?.rarity ?? null,
        isShiny:!!mon?.isShiny, level:Number(mon?.level || 1),
      })),
      lockedCaughtAts:(rankedQueue.publicEntry(queue, targetId).team || []).map((mon) => Number(mon.caughtAt)),
    });
  });

  app.post("/api/widget/trade", (req, res) => {
    setNoCache(res);
    const userId = String(req.twitchUserId);
    const action = String(req.body?.action || "");
    const profile = readJsonSafe(paths.PROFILES_JSON, { users:{} }).users?.[userId];
    let result;
    if (action === "create") {
      const targetId = String(req.body?.targetId || "");
      if (!recentPlayerIds(userId).has(targetId)) return res.status(409).json({ ok:false, error:"player_not_available" });
      const queue = rankedQueue.readQueue(paths.RANKED_QUEUE_JSON, readJsonSafe);
      if (rankedQueue.lockedCaughtAt(queue, userId, Number(req.body?.offerCaughtAt))) return res.status(423).json({ ok:false, error:"ranked_pokemon_locked" });
      if (rankedQueue.lockedCaughtAt(queue, targetId, Number(req.body?.wantCaughtAt))) return res.status(423).json({ ok:false, error:"target_ranked_pokemon_locked" });
      result = trade.createWidgetTrade({ fromId:userId, fromDisplay:profile?.display, toId:targetId, offerCaughtAt:req.body?.offerCaughtAt, wantCaughtAt:req.body?.wantCaughtAt });
    } else if (action === "accept") {
      const pending = readJsonSafe(paths.TRADES_JSON, { pending:{} }).pending || {};
      const current = pending[String(req.body?.tradeId || "")];
      if (current) {
        const queue = rankedQueue.readQueue(paths.RANKED_QUEUE_JSON, readJsonSafe);
        if (rankedQueue.lockedCaughtAt(queue, current.fromId, Number(current.offer?.caughtAt)) || rankedQueue.lockedCaughtAt(queue, current.toId, Number(current.want?.caughtAt))) {
          return res.status(423).json({ ok:false, error:"ranked_pokemon_locked" });
        }
      }
      result = trade.handleAccept({ userId, userName:profile?.display || "Trainer", rawInput:`!accept ${String(req.body?.tradeId || "")}` });
    } else if (action === "decline") {
      result = trade.handleDecline({ userId, rawInput:`!decline ${String(req.body?.tradeId || "")}` });
    } else if (action === "cancel") {
      result = trade.handleCancel({ userId, rawInput:`!cancel ${String(req.body?.tradeId || "")}` });
    } else return res.status(400).json({ ok:false, error:"invalid_action" });
    if (!result.ok) {
      const status = ["missing_trade", "missing_pokemon", "missing_inventory"].includes(result.reason) ? 409
        : ["not_for_you", "not_yours"].includes(result.reason) ? 403 : 400;
      return res.status(status).json({ ok:false, error:result.reason });
    }
    return res.json(result);
  });

  app.post("/api/widget/action", (req, res) => {
    setNoCache(res);
    const userId=req.twitchUserId, action=String(req.body?.action||"").trim(), caughtAt=Number(req.body?.caughtAt||0);
    if (!userId || !action || !caughtAt) return res.status(400).json({ok:false,error:"invalid_request"});
    const pokedex=readJsonSafe(paths.POKEDEX_JSON,{users:{}}), profiles=readJsonSafe(paths.PROFILES_JSON,{users:{}}), caught=pokedex.users?.[userId]?.caught;
    const monIndex=Array.isArray(caught)?caught.findIndex((mon)=>Number(mon?.caughtAt)===caughtAt):-1, mon=monIndex>=0?caught[monIndex]:null, profile=profiles.users?.[userId];
    if (!profile || !mon) return res.status(404).json({ok:false,error:"pokemon_not_found"});
    profile.party??={activeSlot:0,slots:Array(6).fill(null)}; profile.party.slots=Array.from({length:6},(_,i)=>profile.party.slots?.[i]||null); profile.progress??={}; profile.items??={};
    const teamIndex=profile.party.slots.findIndex((slot)=>Number(slot?.caughtAt)===caughtAt), key=`${userId}:${caughtAt}`;
    const queue=rankedQueue.readQueue(paths.RANKED_QUEUE_JSON,readJsonSafe);
    if(rankedQueue.lockedCaughtAt(queue,userId,caughtAt))return res.status(423).json({ok:false,error:"ranked_pokemon_locked"});
    profile.progress[key]??={xp:0,level:1,createdAt:Date.now(),updatedAt:Date.now()}; const progress=profile.progress[key];
    if (action==="team_add") { if(teamIndex>=0)return res.status(409).json({ok:false,error:"already_in_team"}); const requestedSlot=Number(req.body?.slotIndex); const hasRequestedSlot=Number.isInteger(requestedSlot)&&requestedSlot>=0&&requestedSlot<6; const empty=hasRequestedSlot?requestedSlot:profile.party.slots.findIndex((slot)=>!slot); if(empty<0||profile.party.slots[empty])return res.status(409).json({ok:false,error:profile.party.slots[empty]?"slot_occupied":"team_full"}); profile.party.slots[empty]={monKey:key,name:mon.name,displayName:mon.displayName,dexId:mon.dexId??null,spriteUrl:mon.spriteUrl??null,rarity:mon.rarity??null,isShiny:!!mon.isShiny,nature:mon.nature||"hardy",caughtAt,level:Number(progress.level||1),xp:Number(progress.xp||0)}; if(profile.party.slots.filter(Boolean).length===1)profile.party.activeSlot=empty; }
    else if(action==="team_remove") { if(teamIndex<0)return res.status(409).json({ok:false,error:"not_in_team"}); profile.party.slots[teamIndex]=null; if(Number(profile.party.activeSlot)===teamIndex)profile.party.activeSlot=Math.max(0,profile.party.slots.findIndex(Boolean)); }
    else if(action==="team_active") { if(teamIndex<0)return res.status(409).json({ok:false,error:"not_in_team"}); profile.party.activeSlot=teamIndex; }
    else if(action==="release") { if(teamIndex>=0)return res.status(409).json({ok:false,error:"remove_from_team_first"}); caught.splice(monIndex,1); delete profile.progress[key]; fs.writeFileSync(paths.POKEDEX_JSON,JSON.stringify(pokedex,null,2)); }
    else if(action==="evolve") {
      profile.evoLocked??={};
      const level=Math.max(1,Number(progress.level||mon.level||1));
      const rule=evo.getRule(mon.dexId);
      if(!rule)return res.status(409).json({ok:false,error:"no_evolution"});
      if(level<rule.level)return res.status(409).json({ok:false,error:"evolution_level",requiredLevel:rule.level});
      const pendingWasSet=evo.checkAndSetPending(profile,userId,mon,level);
      if(!pendingWasSet||!profile.evoPending)return res.status(409).json({ok:false,error:profile.evoLocked[key]?"evolution_locked":"no_evolution"});
      const evolved=evo.applyEvolution({profiles,profile,userId,userName:profile.display||"Trainer",pending:profile.evoPending});
      if(!evolved.ok)return res.status(409).json({ok:false,error:evolved.reason||"evolution_failed"});
    }
    else if(action==="item_use") { const itemId=String(req.body?.itemId||""),amount=Math.max(1,Math.min(99,Math.floor(Number(req.body?.amount||1)))),values={xp_candy_s:100,xp_candy_m:250,xp_candy_l:600}; if(!values[itemId])return res.status(400).json({ok:false,error:"item_not_supported_yet"}); if(Number(profile.items[itemId]||0)<amount)return res.status(409).json({ok:false,error:"not_enough_items"}); let level=Math.max(1,Number(progress.level||1)),xp=Math.max(0,Number(progress.xp||0))+values[itemId]*amount; while(level<100&&xp>=40+level*20){xp-=40+level*20;level++} if(level>=100){level=100;xp=0} progress.level=level;progress.xp=xp;progress.updatedAt=Date.now();profile.items[itemId]-=amount;if(teamIndex>=0){profile.party.slots[teamIndex].level=level;profile.party.slots[teamIndex].xp=xp;} const outbox=readJsonSafe(paths.CHAT_OUTBOX_JSON,{messages:[]});outbox.messages=Array.isArray(outbox.messages)?outbox.messages:[];outbox.messages.push({message:`🍬 @${profile.display||"Trainer"} nutzt ${amount}x XP-Bonbon auf ${mon.displayName||mon.name}. Jetzt Lv.${level}.`,createdAt:Date.now()});fs.writeFileSync(paths.CHAT_OUTBOX_JSON,JSON.stringify(outbox,null,2)); }
    else return res.status(400).json({ok:false,error:"unknown_action"});
    profile.updatedAt=Date.now(); fs.writeFileSync(paths.PROFILES_JSON,JSON.stringify(profiles,null,2)); res.json({ok:true});
  });
}

module.exports = { installWidgetApi };
