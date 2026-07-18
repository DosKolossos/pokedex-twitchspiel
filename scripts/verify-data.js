const fs = require("fs");
const path = require("path");
const dataDir = process.env.POKEDEX_DATA_DIR || path.join(__dirname, "..", "data");
const files = fs.readdirSync(dataDir).filter((name) => name.endsWith(".json"));
let failed = false;
for (const file of files) {
  try {
    JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
    console.log(`OK ${file}`);
  } catch (error) {
    failed = true;
    console.error(`FEHLER ${file}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
