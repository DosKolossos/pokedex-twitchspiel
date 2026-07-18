#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const REDIRECT_URI = "http://localhost:3000";
const PORT = 3000;

const role = String(process.argv[2] || "").trim().toLowerCase();
const roles = {
  bot: {
    label: "Bot",
    expectedLoginKey: "BOT_LOGIN",
    scopes: ["user:bot", "user:read:chat", "user:write:chat"],
    envKeys: {
      userId: "BOT_USER_ID",
      login: "BOT_LOGIN",
      accessToken: "BOT_ACCESS_TOKEN",
      refreshToken: "BOT_REFRESH_TOKEN",
    },
  },
  broadcaster: {
    label: "Kanalinhaber",
    expectedLoginKey: "BROADCASTER_LOGIN",
    scopes: ["channel:bot", "channel:read:redemptions"],
    envKeys: {
      userId: "BROADCASTER_USER_ID",
      login: "BROADCASTER_LOGIN",
      accessToken: "BROADCASTER_ACCESS_TOKEN",
      refreshToken: "BROADCASTER_REFRESH_TOKEN",
    },
  },
};

if (!roles[role]) {
  console.error("Aufruf:");
  console.error("  node scripts/twitch-oauth-helper.js bot");
  console.error("  node scripts/twitch-oauth-helper.js broadcaster");
  process.exit(1);
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function updateEnvFile(updates) {
  let text = fs.readFileSync(ENV_PATH, "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let lines = text.split(/\r?\n/);

  for (const [key, value] of Object.entries(updates)) {
    const safeValue = String(value).replace(/[\r\n]/g, "");
    const index = lines.findIndex((line) =>
      new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`).test(line)
    );
    if (index >= 0) {
      lines[index] = `${key}=${safeValue}`;
    } else {
      lines.push(`${key}=${safeValue}`);
    }
  }

  fs.writeFileSync(ENV_PATH, lines.join(newline), "utf8");
}

if (!fs.existsSync(ENV_PATH)) {
  console.error(`Fehlt: ${ENV_PATH}`);
  console.error("Erstelle zuerst .env aus .env.example und trage Client-ID sowie Client-Secret ein.");
  process.exit(1);
}

const envText = fs.readFileSync(ENV_PATH, "utf8");
const env = parseEnv(envText);
const clientId = String(env.TWITCH_CLIENT_ID || "").trim();
const clientSecret = String(env.TWITCH_CLIENT_SECRET || "").trim();
const config = roles[role];
const expectedLogin = String(env[config.expectedLoginKey] || "").trim().toLowerCase();

if (!clientId || !clientSecret) {
  console.error("TWITCH_CLIENT_ID oder TWITCH_CLIENT_SECRET fehlt in .env.");
  process.exit(1);
}
if (!expectedLogin) {
  console.error(`${config.expectedLoginKey} fehlt in .env.`);
  process.exit(1);
}

const state = crypto.randomBytes(24).toString("hex");
const authorizeUrl = new URL("https://id.twitch.tv/oauth2/authorize");
authorizeUrl.searchParams.set("client_id", clientId);
authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("scope", config.scopes.join(" "));
authorizeUrl.searchParams.set("state", state);
authorizeUrl.searchParams.set("force_verify", "true");

let finished = false;

function html(res, status, title, message) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui;margin:3rem;max-width:48rem">
<h1>${title}</h1><p>${message}</p>
</body></html>`);
}

const server = http.createServer(async (req, res) => {
  if (finished) {
    html(res, 409, "Bereits abgeschlossen", "Dieser OAuth-Vorgang wurde bereits verarbeitet.");
    return;
  }

  const callback = new URL(req.url, REDIRECT_URI);
  if (callback.pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  const returnedState = callback.searchParams.get("state");
  const code = callback.searchParams.get("code");
  const oauthError = callback.searchParams.get("error");

  if (oauthError) {
    finished = true;
    const description = callback.searchParams.get("error_description") || oauthError;
    html(res, 400, "Autorisierung abgebrochen", description);
    console.error(`Twitch-Autorisierung fehlgeschlagen: ${description}`);
    server.close();
    return;
  }

  if (!code) {
    html(res, 400, "Code fehlt", "In der Twitch-Antwort war kein Autorisierungscode enthalten.");
    return;
  }

  if (!returnedState || returnedState !== state) {
    finished = true;
    html(res, 400, "Ungültiger Statuswert", "Der Sicherheitswert stimmt nicht überein. Bitte neu starten.");
    console.error("OAuth-state stimmt nicht überein.");
    server.close();
    return;
  }

  finished = true;

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    });

    const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));

    if (!tokenResponse.ok || !tokenData.access_token || !tokenData.refresh_token) {
      const detail = tokenData.message || tokenData.error_description || tokenData.error || "unbekannter Fehler";
      throw new Error(`Token-Austausch fehlgeschlagen (${tokenResponse.status}): ${detail}`);
    }

    const validateResponse = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${tokenData.access_token}` },
    });
    const validateData = await validateResponse.json().catch(() => ({}));

    if (!validateResponse.ok || !validateData.user_id || !validateData.login) {
      throw new Error(`Token-Prüfung fehlgeschlagen (${validateResponse.status}).`);
    }

    const actualLogin = String(validateData.login).toLowerCase();
    if (actualLogin !== expectedLogin) {
      throw new Error(
        `Falscher Twitch-Account autorisiert: ${validateData.login}. Erwartet wurde ${expectedLogin}.`
      );
    }

    updateEnvFile({
      [config.envKeys.userId]: validateData.user_id,
      [config.envKeys.login]: validateData.login,
      [config.envKeys.accessToken]: tokenData.access_token,
      [config.envKeys.refreshToken]: tokenData.refresh_token,
    });

    html(
      res,
      200,
      "Autorisierung erfolgreich",
      `${config.label} „${validateData.login}“ wurde gespeichert. Dieses Fenster kann geschlossen werden.`
    );
    console.log("");
    console.log(`ERFOLG: ${config.label} ${validateData.login} (${validateData.user_id})`);
    console.log(`Die Werte wurden sicher in ${ENV_PATH} eingetragen.`);
    console.log("Es wurden keine Tokens im Terminal ausgegeben.");
  } catch (error) {
    html(res, 500, "Autorisierung fehlgeschlagen", String(error.message || error));
    console.error(`FEHLER: ${error.message || error}`);
  } finally {
    server.close();
  }
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} ist bereits belegt. Schließe das andere Programm oder den alten OAuth-Helfer.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`OAuth-Helfer wartet auf ${REDIRECT_URI}`);
  console.log(`Rolle: ${config.label}`);
  console.log(`Erwarteter Twitch-Account: ${expectedLogin}`);
  console.log("");
  console.log("Kopiere diese URL vollständig in den Browser mit dem richtigen Twitch-Account:");
  console.log("");
  console.log(authorizeUrl.toString());
  console.log("");
  console.log("Nach der Bestätigung schreibt der Helfer IDs und Tokens direkt in die lokale .env.");
  console.log("Tokens oder Client-Secret niemals in den Chat kopieren.");
});

setTimeout(() => {
  if (!finished) {
    console.error("Zeitüberschreitung nach 10 Minuten. Bitte den Helfer erneut starten.");
    server.close(() => process.exit(1));
  }
}, 10 * 60 * 1000);
