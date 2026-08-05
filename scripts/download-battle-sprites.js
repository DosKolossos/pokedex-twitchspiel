const fs = require("fs");
const path = require("path");
const https = require("https");

const root = path.join(__dirname, "..", "sprites");
const variants = {
  front: "sprites/pokemon/versions/generation-v/black-white/animated",
  back: "sprites/pokemon/versions/generation-v/black-white/animated/back",
  icons: "sprites/pokemon"
};

function download(url, destination) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination) && fs.statSync(destination).size > 100) return resolve(false);
    const file = fs.createWriteStream(destination);
    https.get(url, { headers: { "User-Agent": "SchiggyGang-PokeDex" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close(); fs.rmSync(destination, { force: true });
        return download(response.headers.location, destination).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        file.close(); fs.rmSync(destination, { force: true });
        return reject(new Error(`${response.statusCode} ${url}`));
      }
      response.pipe(file);
      file.on("finish", () => file.close(() => resolve(true)));
    }).on("error", (error) => { file.close(); fs.rmSync(destination, { force: true }); reject(error); });
  });
}

(async () => {
  let downloaded = 0;
  const tasks = [];
  for (let dexId = 1; dexId <= 151; dexId += 1) {
    for (const [variant, remote] of Object.entries(variants)) {
      const extension = variant === "icons" ? "png" : "gif";
      const url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/${remote}/${dexId}.${extension}`;
      tasks.push(() => download(url, path.join(root, variant, `${dexId}.${extension}`)));
    }
  }
  for (let index = 0; index < tasks.length; index += 12) {
    const results = await Promise.all(tasks.slice(index, index + 12).map((task) => task()));
    downloaded += results.filter(Boolean).length;
    process.stdout.write(`\rSprites: ${Math.min(index + 12, tasks.length)} / ${tasks.length}`);
  }
  process.stdout.write("\n");
  console.log(`Kampf-Sprites bereit (${downloaded} neu heruntergeladen).`);
})().catch((error) => { console.error("Sprite-Download fehlgeschlagen:", error.message); process.exitCode = 1; });
