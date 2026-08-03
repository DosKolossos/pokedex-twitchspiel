# PokéDex-Widget

## Aktueller Stand

- Erfolgreiche Fangteilnahmen werden gespeichert, aber nicht mehr im Twitch-Chat bestätigt.
- Smartphone-Ansicht mit Team/PC, Items, PokéDex, Multiplayer und Ranks.
- Hilfe oben links und Benachrichtigungsglocke oben rechts.
- Widget-Daten werden aus `data/pokedex.json`, `data/profiles.json`, `data/trades.json`, `data/raidState.json` und `data/dexmap.json` zusammengeführt.
- Pop-out-Layout kann mit `&popout=true` getestet werden.

## Lokal oder auf Hetzner testen

Overlay-Server starten und eine vorhandene Twitch-ID aus `data/profiles.json` einsetzen:

```text
http://127.0.0.1:3010/widget/?userId=TWITCH_ID
```

## Sicherheitsgrenze

`/api/widget/player?userId=...` ist zunächst nur eine Entwicklungsroute. Sie darf nicht öffentlich freigegeben werden, bevor der Server die Twitch-Extension-JWT prüft und die Spieler-ID daraus ableitet. Schreibaktionen für Team, Items, Tausch und Kämpfe werden erst danach ergänzt.

## GitHub-Deployment

Der Workflow `.github/workflows/deploy-hetzner.yml` benötigt diese Repository-Secrets:

- `HETZNER_HOST`
- `HETZNER_USER`
- `HETZNER_SSH_KEY`
- `HETZNER_KNOWN_HOSTS`

Auf dem Server bleiben `/opt/pokedex/.env` und `/opt/pokedex/data/` erhalten. Das Deployment akzeptiert nur Fast-Forward-Updates, installiert Produktionsabhängigkeiten, prüft das Projekt und lädt die drei PM2-Prozesse neu.

Der einmal direkt auf Hetzner ergänzte Token-Startfix in `server/bot.js` ist in dieser Version ebenfalls Bestandteil des Repositorys. Der erste Deploy bereinigt die lokale Datei nur dann automatisch, wenn sie bereits exakt dem neuen GitHub-Stand entspricht; andere Serveränderungen führen sicherheitshalber zum Abbruch.
