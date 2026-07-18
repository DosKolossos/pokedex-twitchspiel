const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = path.join(__dirname, "..", "runtime");
const TOKEN_FILE = path.join(RUNTIME_DIR, "tokens.json");

function readRuntimeTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return {};
  }
}

function persistRuntimeTokens(tokens) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const tmp = `${TOKEN_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tokens, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, TOKEN_FILE);
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch {}
}

class TokenManager {
  constructor({ name, clientId, clientSecret, accessToken, refreshToken }) {
    this.name = name;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    const runtime = readRuntimeTokens()[name] || {};
    this.accessToken = runtime.accessToken || accessToken || "";
    this.refreshToken = runtime.refreshToken || refreshToken || "";
    this.expiresAt = Number(runtime.expiresAt || 0);
    this.refreshPromise = null;
  }

  async validate() {
    if (!this.accessToken) throw new Error(`${this.name}: Access Token fehlt`);
    const response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${this.accessToken}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    this.expiresAt = Date.now() + Number(data.expires_in || 0) * 1000;
    this.persist();
    return data;
  }

  async getAccessToken() {
    const shouldValidate = !this.expiresAt || this.expiresAt - Date.now() < 60 * 60 * 1000;
    if (shouldValidate) {
      const valid = await this.validate().catch(() => null);
      if (!valid) await this.refresh();
    }
    return this.accessToken;
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async doRefresh() {
    if (!this.refreshToken) throw new Error(`${this.name}: Refresh Token fehlt`);
    if (!this.clientId || !this.clientSecret) throw new Error(`${this.name}: Client-ID oder Client-Secret fehlt`);

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(`${this.name}: Token-Aktualisierung fehlgeschlagen (${response.status}): ${JSON.stringify(data)}`);
    }

    this.accessToken = data.access_token;
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    this.expiresAt = Date.now() + Number(data.expires_in || 0) * 1000;
    this.persist();
    return this.accessToken;
  }

  persist() {
    const all = readRuntimeTokens();
    all[this.name] = {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.expiresAt,
      updatedAt: Date.now(),
    };
    persistRuntimeTokens(all);
  }
}

module.exports = { TokenManager };
