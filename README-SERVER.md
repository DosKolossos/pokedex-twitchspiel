# Pokédex-Twitchspiel – Serverversion

Diese Fassung ist für Ubuntu, Node 22 und PM2 vorbereitet.

## Sicherheitsbereinigung

Nicht übernommen wurden `pass.txt`, `upload-pokedex.txt`, `winscp.log`, das alte Firebase-Verzeichnis, lokale `node_modules`, generierte Chat-Ausgaben und die große Debug-Logdatei.

## Aufbau

- `server/bot.js`: Twitch EventSub, Chatbefehle, Kanalpunkte und Timer
- `overlay-server.js`: internes OBS-Overlay auf `127.0.0.1:3010`
- `data/`: bestehende Spielstände und Konfigurationen
- `ecosystem.config.cjs`: PM2-Konfiguration
- `scripts/backup-data.sh`: Spielstandbackup

## Noch bewusst deaktiviert

Automatische Spawns stehen in `.env.example` auf `0`. Der genaue alte Streamer.bot-Timer muss zuerst bestätigt werden, damit sich das Spielverhalten nicht unbemerkt ändert.

## Benötigte Twitch-Berechtigungen

Bot-Token:
- `user:bot`
- `user:read:chat`
- `user:write:chat`

Broadcaster-Token:
- `channel:bot`
- `channel:read:redemptions`

## Installation auf dem Server

```bash
cd /opt/pokedex
cp .env.example .env
chmod 600 .env
npm ci
npm run check
npm run verify-data
```

Erst nach vollständiger `.env`-Konfiguration:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```
