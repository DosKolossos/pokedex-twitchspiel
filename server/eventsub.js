class EventSubConnection {
  constructor({ name, tokenManager, twitchApi, subscriptions, onNotification }) {
    this.name = name;
    this.tokenManager = tokenManager;
    this.twitchApi = twitchApi;
    this.subscriptions = subscriptions;
    this.onNotification = onNotification;
    this.socket = null;
    this.reconnectAttempt = 0;
    this.keepaliveTimer = null;
    this.intentionalHandoff = false;
    this.recentMessageIds = new Map();
  }

  async start(url = "wss://eventsub.wss.twitch.tv/ws", isReconnectHandoff = false) {
    await this.tokenManager.getAccessToken();
    this.intentionalHandoff = isReconnectHandoff;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      console.log(`[eventsub:${this.name}] WebSocket verbunden`);
    });

    socket.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(String(event.data));
        await this.handleMessage(data, isReconnectHandoff);
      } catch (error) {
        console.error(`[eventsub:${this.name}] Nachricht konnte nicht verarbeitet werden:`, error);
      }
    });

    socket.addEventListener("error", (event) => {
      console.error(`[eventsub:${this.name}] WebSocket-Fehler`, event?.message || "");
    });

    socket.addEventListener("close", () => {
      this.clearKeepalive();
      if (this.intentionalHandoff) {
        this.intentionalHandoff = false;
        return;
      }
      this.scheduleReconnect();
    });
  }

  async handleMessage(data, isReconnectHandoff) {
    const metadata = data.metadata || {};
    const messageId = metadata.message_id;
    if (messageId && this.isDuplicate(messageId)) return;
    this.armKeepalive(data.payload?.session?.keepalive_timeout_seconds);

    switch (metadata.message_type) {
      case "session_welcome": {
        this.reconnectAttempt = 0;
        const sessionId = data.payload?.session?.id;
        if (!sessionId) throw new Error("EventSub Session-ID fehlt");
        if (!isReconnectHandoff) {
          for (const subscription of this.subscriptions) {
            const created = await this.twitchApi.createSubscription({
              ...subscription,
              sessionId,
              tokenManager: this.tokenManager,
            });
            console.log(`[eventsub:${this.name}] abonniert: ${subscription.type} (${created?.id || "?"})`);
          }
        } else {
          console.log(`[eventsub:${this.name}] Reconnect-Übergabe abgeschlossen`);
        }
        break;
      }
      case "session_keepalive":
        break;
      case "session_reconnect": {
        const reconnectUrl = data.payload?.session?.reconnect_url;
        if (!reconnectUrl) throw new Error("Reconnect-URL fehlt");
        this.intentionalHandoff = true;
        const oldSocket = this.socket;
        await this.start(reconnectUrl, true);
        setTimeout(() => {
          try { oldSocket?.close(); } catch {}
        }, 1000);
        break;
      }
      case "notification":
        await this.onNotification(metadata.subscription_type, data.payload?.event || {});
        break;
      case "revocation":
        console.error(`[eventsub:${this.name}] Subscription widerrufen:`, data.payload?.subscription || {});
        break;
      default:
        console.log(`[eventsub:${this.name}] unbekannter Nachrichtentyp: ${metadata.message_type}`);
    }
  }

  isDuplicate(messageId) {
    const now = Date.now();
    for (const [id, expires] of this.recentMessageIds) {
      if (expires <= now) this.recentMessageIds.delete(id);
    }
    if (this.recentMessageIds.has(messageId)) return true;
    this.recentMessageIds.set(messageId, now + 10 * 60 * 1000);
    return false;
  }

  armKeepalive(timeoutSeconds) {
    this.clearKeepalive();
    const seconds = Number(timeoutSeconds || 10) + 10;
    this.keepaliveTimer = setTimeout(() => {
      console.error(`[eventsub:${this.name}] Keepalive überschritten, verbinde neu`);
      try { this.socket?.close(); } catch {}
    }, seconds * 1000);
  }

  clearKeepalive() {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }

  scheduleReconnect() {
    const delay = Math.min(60_000, 2_000 * 2 ** this.reconnectAttempt++);
    console.log(`[eventsub:${this.name}] Neuverbindung in ${Math.round(delay / 1000)}s`);
    setTimeout(() => this.start().catch((error) => {
      console.error(`[eventsub:${this.name}] Neuverbindung fehlgeschlagen:`, error);
      this.scheduleReconnect();
    }), delay);
  }

  stop() {
    this.intentionalHandoff = true;
    this.clearKeepalive();
    try { this.socket?.close(); } catch {}
  }
}

module.exports = { EventSubConnection };
