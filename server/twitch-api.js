class TwitchApi {
  constructor({ clientId, botUserId, broadcasterUserId, botTokenManager }) {
    this.clientId = clientId;
    this.botUserId = botUserId;
    this.broadcasterUserId = broadcasterUserId;
    this.botTokenManager = botTokenManager;
  }

  async request(url, options = {}, tokenManager = this.botTokenManager, retry = true) {
    const token = await tokenManager.getAccessToken();
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.clientId,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });

    if (response.status === 401 && retry) {
      await tokenManager.refresh();
      return this.request(url, options, tokenManager, false);
    }
    return response;
  }

  async createSubscription({ type, version = "1", condition, sessionId, tokenManager }) {
    const response = await this.request(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        method: "POST",
        body: JSON.stringify({
          type,
          version,
          condition,
          transport: { method: "websocket", session_id: sessionId },
        }),
      },
      tokenManager
    );
    const data = await response.json().catch(() => ({}));
    if (response.status !== 202) {
      throw new Error(`EventSub ${type} fehlgeschlagen (${response.status}): ${JSON.stringify(data)}`);
    }
    return data.data?.[0] || null;
  }

  async sendChatMessage(message) {
    const response = await this.request("https://api.twitch.tv/helix/chat/messages", {
      method: "POST",
      body: JSON.stringify({
        broadcaster_id: this.broadcasterUserId,
        sender_id: this.botUserId,
        message,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Chat-Nachricht fehlgeschlagen (${response.status}): ${JSON.stringify(data)}`);
    }
    const sent = data.data?.[0];
    if (sent && sent.is_sent === false) {
      throw new Error(`Chat-Nachricht verworfen: ${JSON.stringify(sent.drop_reason || {})}`);
    }
    return sent;
  }

  async isStreamLive() {
    const url = new URL("https://api.twitch.tv/helix/streams");
    url.searchParams.set("user_id", this.broadcasterUserId);
    const response = await this.request(url.toString(), { method: "GET" });
    if (!response.ok) return false;
    const data = await response.json();
    return Array.isArray(data.data) && data.data.length > 0;
  }

  async updateRedemptionStatus({ rewardId, redemptionId, status, tokenManager }) {
    const url = new URL("https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions");
    url.searchParams.set("broadcaster_id", this.broadcasterUserId);
    url.searchParams.set("reward_id", String(rewardId));
    url.searchParams.set("id", String(redemptionId));
    const response = await this.request(url.toString(), { method:"PATCH", body:JSON.stringify({ status }) }, tokenManager);
    if (!response.ok) throw new Error(`Einlösung konnte nicht auf ${status} gesetzt werden (${response.status})`);
    return response.json();
  }
}

module.exports = { TwitchApi };
