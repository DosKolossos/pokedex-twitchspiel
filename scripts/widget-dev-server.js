const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WIDGET_DIR = path.join(ROOT, "widget");

const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
const PORT = Number(process.env.WIDGET_DEV_PORT || 8080);
const USER_ID = String(process.env.DEV_TWITCH_USER_ID || "").trim();
const DEV_KEY = String(process.env.WIDGET_DEV_KEY || "").trim();
const API_URL = new URL(String(process.env.WIDGET_DEV_API_URL || "https://overlay.schiggygang.de"));

if (!/^\d+$/.test(USER_ID)) {
  console.error("[widget-dev] DEV_TWITCH_USER_ID fehlt oder ist keine numerische Twitch-ID.");
  process.exit(1);
}
if (DEV_KEY.length < 32) {
  console.error("[widget-dev] WIDGET_DEV_KEY fehlt oder ist kürzer als 32 Zeichen.");
  process.exit(1);
}

const mimeTypes = { ".css":"text/css; charset=utf-8", ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".png":"image/png", ".svg":"image/svg+xml" };

function proxyApi(req, res, url) {
  url.searchParams.set("userId", USER_ID);
  const headers = { ...req.headers, host: API_URL.host, "x-widget-dev-key": DEV_KEY };
  delete headers.origin;
  delete headers.referer;
  const upstream = https.request({
    protocol: API_URL.protocol,
    hostname: API_URL.hostname,
    port: API_URL.port || 443,
    method: req.method,
    path: `${API_URL.pathname.replace(/\/$/, "")}${url.pathname}${url.search}`,
    headers,
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  upstream.on("error", (error) => {
    console.error("[widget-dev] API nicht erreichbar:", error.message);
    if (!res.headersSent) res.writeHead(502, { "Content-Type":"application/json" });
    res.end(JSON.stringify({ ok:false, error:"development_api_unreachable" }));
  });
  req.pipe(upstream);
}

function serveFile(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(WIDGET_DIR, requested);
  if (!filePath.startsWith(`${WIDGET_DIR}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type":"text/plain; charset=utf-8" });
    return res.end("Nicht gefunden");
  }
  res.writeHead(200, { "Content-Type":mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control":"no-store" });
  fs.createReadStream(filePath).pipe(res);
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname.startsWith("/api/widget/")) return proxyApi(req, res, url);
  if (url.pathname === "/" && !url.searchParams.has("userId")) {
    res.writeHead(302, { Location:`/?userId=${encodeURIComponent(USER_ID)}` });
    return res.end();
  }
  return serveFile(res, url.pathname);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[widget-dev] PokéDex läuft auf http://127.0.0.1:${PORT}`);
  console.log("[widget-dev] Änderungen im Ordner widget/ sind nach Neuladen sichtbar.");
});
