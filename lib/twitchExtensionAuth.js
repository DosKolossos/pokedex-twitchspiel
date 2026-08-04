const crypto = require("crypto");

function base64UrlDecode(value) {
  return Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function verifyExtensionJwt(token, encodedSecret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("token_malformed");

  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf8"));
  } catch {
    throw new Error("token_malformed");
  }

  if (header?.alg !== "HS256") throw new Error("token_algorithm_invalid");
  const secret = Buffer.from(String(encodedSecret || ""), "base64");
  if (!secret.length) throw new Error("extension_secret_missing");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest();
  const supplied = base64UrlDecode(parts[2]);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    throw new Error("token_signature_invalid");
  }

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now - 5) {
    throw new Error("token_expired");
  }
  if (!payload.channel_id || !["viewer", "moderator", "broadcaster"].includes(payload.role)) {
    throw new Error("token_claims_invalid");
  }

  return payload;
}

function widgetCors(req, res, next) {
  const origin = String(req.headers.origin || "");
  const allowed = /^https:\/\/[a-z0-9]+\.ext-twitch\.tv$/i.test(origin)
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Widget-Dev-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

function requireExtensionIdentity(req, res, next) {
  const configuredDevKey = String(process.env.WIDGET_DEV_KEY || "").trim();
  const suppliedDevKey = String(req.headers["x-widget-dev-key"] || "").trim();
  const devUserId = String(req.query?.userId || req.body?.userId || "").trim();
  const validDevKey = configuredDevKey.length >= 32
    && suppliedDevKey.length === configuredDevKey.length
    && crypto.timingSafeEqual(Buffer.from(suppliedDevKey), Buffer.from(configuredDevKey));
  if (validDevKey && /^\d+$/.test(devUserId)) {
    req.twitchUserId = devUserId;
    req.twitchAuth = { development: true, role: "viewer" };
    return next();
  }

  const authorization = String(req.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ ok: false, error: "auth_required" });

  try {
    const payload = verifyExtensionJwt(match[1], process.env.TWITCH_EXTENSION_SECRET);
    const expectedChannel = String(process.env.TWITCH_EXTENSION_CHANNEL_ID || "").trim();
    if (expectedChannel && String(payload.channel_id) !== expectedChannel) {
      return res.status(403).json({ ok: false, error: "channel_not_allowed" });
    }
    if (!/^\d+$/.test(String(payload.user_id || ""))) {
      return res.status(403).json({ ok: false, error: "identity_link_required" });
    }
    req.twitchUserId = String(payload.user_id);
    req.twitchAuth = payload;
    return next();
  } catch (error) {
    console.warn("[widget-auth] Token abgelehnt:", error.message);
    return res.status(401).json({ ok: false, error: error.message || "token_invalid" });
  }
}

module.exports = { requireExtensionIdentity, verifyExtensionJwt, widgetCors };
