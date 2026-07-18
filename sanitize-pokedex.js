#!/usr/bin/env node
/**
 * sanitize-pokedex.js
 * - füllt fehlende dexId/spriteUrl in pokedex.json nach
 * - nutzt (wenn vorhanden) dexmap.json (wie poke.js)
 * - kann dexId auch aus vorhandener spriteUrl extrahieren
 *
 * Usage:
 *   node sanitize-pokedex.js
 *   node sanitize-pokedex.js --dry
 */

const RE_STRIP_NONWORD = (() => {
    try {
        // bevorzugt: unicode property escapes (wenn verfügbar)
        return new RegExp("[^\\p{L}\\p{N}\\s\\-\\.:]", "gu");
    } catch {
        // fallback: wir normalisieren ohnehin auf ASCII (ä->ae usw.)
        return /[^a-z0-9\s\-\.\:]/gi;
    }
})();


const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const DRY = args.includes("--dry") || args.includes("--dry-run");

const DATA_FILE = path.join(__dirname, "pokedex.json");
const DEXMAP_FILE = path.join(__dirname, "dexmap.json");

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJson(file, obj) {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}
function stamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function buildSpriteUrl(dexId) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexId}.png`;
}

function extractIdFromSprite(url) {
    const s = String(url || "");
    // bevorzugt official-artwork/<id>.png
    let m = s.match(/official-artwork\/(\d+)\.png/i);
    if (m) return Number(m[1]);
    // fallback: irgendwas/.../<id>.png
    m = s.match(/\/(\d+)\.png(\?|$)/);
    if (m) return Number(m[1]);
    return null;
}

function stripShinyPrefix(s) {
    return String(s || "")
        .trim()
        .replace(/^✨\s*shiny\s+/i, "")
        .replace(/^shiny\s+/i, "");
}

function candidateKeys(name) {
    const base = stripShinyPrefix(name);
    const lower = base.toLowerCase().trim();
    const collapse = lower.replace(/\s+/g, " ");
    const gender = collapse.replace(/♀/g, "f").replace(/♂/g, "m");
    const de = gender
        .replace(/ä/g, "ae")
        .replace(/ö/g, "oe")
        .replace(/ü/g, "ue")
        .replace(/ß/g, "ss");
    const clean = de
        .replace(/[’'`]/g, "")
        .replace(RE_STRIP_NONWORD, "")
        .trim();
    const slug = clean.replace(/\s+/g, "-");

    return [...new Set([lower, collapse, gender, de, clean, slug])].filter(Boolean);
}

function lookupDexInfo(dexmap, nameOrDisplay) {
    for (const key of candidateKeys(nameOrDisplay)) {
        const v = dexmap[key];
        if (v == null) continue;

        if (typeof v === "number") return { dexId: v };
        if (typeof v === "string" && /^\d+$/.test(v)) return { dexId: Number(v) };

        if (typeof v === "object") {
            const id =
                v.dexId ?? v.id ?? v.dex ?? v.number ?? v.nationalDex ?? v.natDex;
            const spriteUrl = v.spriteUrl ?? v.sprite ?? v.url;
            if (id != null) return { dexId: Number(id), spriteUrl };
        }
    }
    return null;
}

function ensureDexFields(dexmap, p) {
    // 1) Wenn spriteUrl existiert -> dexId daraus ziehen
    let dexId = p.dexId ?? extractIdFromSprite(p.spriteUrl);

    // 2) Wenn noch kein dexId -> aus dexmap anhand name/displayName
    if (!dexId) {
        const info =
            lookupDexInfo(dexmap, p.name) || lookupDexInfo(dexmap, p.displayName);
        if (info?.dexId) dexId = info.dexId;
        if (!p.spriteUrl && info?.spriteUrl) p.spriteUrl = info.spriteUrl;
    }

    // 3) spriteUrl aus dexId bauen, falls fehlt
    if (dexId && !p.spriteUrl) {
        p.spriteUrl = buildSpriteUrl(dexId);
    }

    // 4) dexId setzen, falls wir eins haben
    if (dexId) p.dexId = Number(dexId);

    return p;
}

// --- main
if (!fs.existsSync(DATA_FILE)) {
    console.error("❌ pokedex.json nicht gefunden:", DATA_FILE);
    process.exit(1);
}
if (!fs.existsSync(DEXMAP_FILE)) {
    console.error("❌ dexmap.json nicht gefunden:", DEXMAP_FILE);
    process.exit(1);
}

const data = readJson(DATA_FILE);
const dexmap = readJson(DEXMAP_FILE);

let total = 0;
let fixedDex = 0;
let fixedSprite = 0;
const unresolved = new Map(); // name -> count

for (const [uid, user] of Object.entries(data.users || {})) {
    const caught = Array.isArray(user.caught) ? user.caught : [];
    for (const p of caught) {
        total++;

        const beforeDex = p.dexId ?? null;
        const beforeSprite = p.spriteUrl ?? null;

        ensureDexFields(dexmap, p);

        const afterDex = p.dexId ?? null;
        const afterSprite = p.spriteUrl ?? null;

        if (!beforeDex && afterDex) fixedDex++;
        if (!beforeSprite && afterSprite) fixedSprite++;

        if (!afterDex || !afterSprite) {
            const key = stripShinyPrefix(p.name || p.displayName || "<?>") || "<?>";

            unresolved.set(key, (unresolved.get(key) || 0) + 1);
        }
    }
}

console.log("✅ Sanitizer-Check");
console.log("   Pokémon total:", total);
console.log("   dexId ergänzt:", fixedDex);
console.log("   spriteUrl ergänzt:", fixedSprite);

if (unresolved.size) {
    console.log("⚠️  Unaufgelöst (dexId oder spriteUrl fehlt weiterhin):");
    for (const [name, cnt] of [...unresolved.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`   - ${name} (${cnt}x)`);
    }
    console.log("   -> Lösung: dexmap.json um diese Namen ergänzen (Key = name.toLowerCase()).");
}

if (DRY) {
    console.log("🧪 Dry-Run: keine Datei geschrieben.");
    process.exit(0);
}

const backup = path.join(__dirname, `pokedex.backup-${stamp()}.json`);
fs.copyFileSync(DATA_FILE, backup);
writeJson(DATA_FILE, data);

console.log("💾 pokedex.json aktualisiert.");
console.log("🧷 Backup erstellt:", path.basename(backup));
