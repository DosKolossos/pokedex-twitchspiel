# PokéDex-Widget lokal entwickeln

Das lokale Widget lädt deine echten PokéDex-Daten über einen geheimen Entwicklungsschlüssel.

## 1. Einmalig einen Schlüssel erzeugen

Im Windows-Terminal im Projektordner:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Den ausgegebenen Wert kopieren und niemandem schicken.

## 2. Hetzner konfigurieren

In `/opt/pokedex/.env` ergänzen:

```env
WIDGET_DEV_KEY=DEIN_ERZEUGTER_SCHLUESSEL
```

Danach:

```bash
pm2 restart pokedex-overlay --update-env
pm2 logs pokedex-overlay --lines 20
```

Die Logansicht mit `Strg + C` verlassen.

## 3. Windows konfigurieren

Im Projektordner eine Datei `.env` anlegen oder ergänzen:

```env
DEV_TWITCH_USER_ID=DEINE_NUMERISCHE_TWITCH_ID
WIDGET_DEV_KEY=DERSELBE_ERZEUGTE_SCHLUESSEL
WIDGET_DEV_API_URL=https://overlay.schiggygang.de
WIDGET_DEV_PORT=8080
```

Die `.env` wird nicht zu GitHub hochgeladen.

## 4. Widget starten

```powershell
npm install
npm run widget:dev
```

Danach `http://127.0.0.1:8080` öffnen. Änderungen an den Dateien im Ordner `widget` sind nach einem Neuladen sichtbar. Beenden mit `Strg + C`.
