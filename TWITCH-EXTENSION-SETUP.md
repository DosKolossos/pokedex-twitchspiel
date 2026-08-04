# SchiggyGang-Pokédex als Twitch-Panel

## Sichere Identität

Das Frontend erhält über den Twitch Extension Helper ein kurzlebiges JWT. Jeder
Request an `/api/widget/*` sendet dieses Token als `Authorization: Bearer ...`.
Der Hetzner-Server prüft Signatur, Ablaufzeit, Rolle und optional die Kanal-ID.
Die numerische Trainer-ID wird ausschließlich aus dem verifizierten Claim
`user_id` übernommen.

`?userId=` ist nur verfügbar, wenn auf dem Server ausdrücklich
`WIDGET_DEV_AUTH=true` gesetzt ist. Im Produktivbetrieb muss der Wert `false`
bleiben.

## Servervariablen

In `/opt/pokedex/.env` ergänzen:

```env
TWITCH_EXTENSION_SECRET=BASE64_SECRET_AUS_DER_TWITCH_CONSOLE
TWITCH_EXTENSION_CHANNEL_ID=NUMERISCHE_ID_DES_SCHIGGYGANG_KANALS
WIDGET_DEV_AUTH=false
```

Das Secret niemals committen oder in das Twitch-Frontend-ZIP legen.

## Twitch Asset Hosting

- Panel-Anzeigepfad: `index.html`
- Mobilgerätepfad: `index.html`
- Panelhöhe: `500`
- Fetch-Allowlist: `https://overlay.schiggygang.de`, `https://pokeapi.co`
- Image-Allowlist: `https://overlay.schiggygang.de`, `https://raw.githubusercontent.com`
- Identitätslink anfordern: `Ja`

Unter **Dateien** nur das separate Paket `pokedex-twitch-panel-v0.1.0.zip`
hochladen. Der Node-Server und das Twitch-Secret bleiben auf Hetzner.
