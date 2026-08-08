const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pokedex-widget-trade-"));
process.env.POKEDEX_DATA_DIR = temp;
fs.mkdirSync(path.join(temp, "out"), { recursive:true });

const mon = (caughtAt, dexId, name) => ({ caughtAt, dexId, name, displayName:name, rarity:"common", spriteUrl:`/${dexId}.png` });
fs.writeFileSync(path.join(temp, "pokedex.json"), JSON.stringify({ users:{
  "100":{ id:"100", display:"Alpha", caught:[mon(1001, 25, "Pikachu"), mon(1002, 64, "Kadabra")] },
  "200":{ id:"200", display:"Beta", caught:[mon(2001, 7, "Schiggy"), mon(2002, 93, "Alpollo")] },
} }, null, 2));
fs.writeFileSync(path.join(temp, "profiles.json"), JSON.stringify({ users:{
  "100":{ display:"Alpha", party:{ activeSlot:0, slots:[{ ...mon(1002,64,"Kadabra"), monKey:"100:1002", level:20 }, null,null,null,null,null] }, progress:{ "100:1002":{ level:20,xp:3 } } },
  "200":{ display:"Beta", party:{ activeSlot:0, slots:[{ ...mon(2002,93,"Alpollo"), monKey:"200:2002", level:20 }, null,null,null,null,null] }, progress:{ "200:2002":{ level:20,xp:4 } } },
} }, null, 2));
fs.writeFileSync(path.join(temp, "trades.json"), JSON.stringify({ nextId:1, pending:{} }));

const trade = require("../lib/trade");
const created = trade.createWidgetTrade({ fromId:"100", fromDisplay:"Alpha", toId:"200", offerCaughtAt:1002, wantCaughtAt:2002 });
assert.deepStrictEqual(created, { ok:true, tradeId:"1" });
assert.strictEqual(trade.createWidgetTrade({ fromId:"100", toId:"200", offerCaughtAt:1002, wantCaughtAt:2002 }).reason, "duplicate_trade");

const accepted = trade.handleAccept({ userId:"200", userName:"Beta", rawInput:"!accept 1" });
assert.strictEqual(accepted.ok, true);
const dex = JSON.parse(fs.readFileSync(path.join(temp, "pokedex.json"), "utf8"));
assert.strictEqual(dex.users["100"].caught.some((entry) => entry.dexId === 94), true, "Alpha bekommt entwickeltes Gengar");
assert.strictEqual(dex.users["200"].caught.some((entry) => entry.dexId === 65), true, "Beta bekommt entwickeltes Simsala");
const profiles = JSON.parse(fs.readFileSync(path.join(temp, "profiles.json"), "utf8"));
assert.strictEqual(profiles.users["100"].party.slots[0].dexId, 94);
assert.strictEqual(profiles.users["200"].party.slots[0].dexId, 65);
assert.strictEqual(profiles.users["100"].tradeHistory[0].players[0].gave.dexId, 64, "Historie bewahrt abgegebenes Pokémon vor Entwicklung");
assert.strictEqual(profiles.users["200"].tradeHistory[0].players[1].gave.dexId, 93);
assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(temp, "trades.json"), "utf8")).pending, {});
console.log("✓ Widget-Tausch: Anfrage, Duplikatschutz, Annahme, Tauschentwicklung, Team-Sync und Historie");
