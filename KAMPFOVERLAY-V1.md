# Kampfoverlay – erster Vorführmodus

## Änderung in v1.9

Die Einfahrt der Pokémon ist jetzt eine abgeschlossene Einzelanimation. Sie wird ausschließlich beim Kampfbeginn und bei einem echten Pokémon-Wechsel ausgelöst und kann zwischen zwei Attacken nicht erneut starten.

Der Prototyp spielt Kampf 4 aus dem Kampflabor in klassischer Perspektive ab. Er verändert keine Spielerdaten.

```bash
npm install
npm run sprites:battle
npm run test:battle
pm2 restart pokedex-overlay --update-env
```

Danach ist die Ansicht unter `https://overlay.schiggygang.de/battle.html` erreichbar. Für OBS wird diese URL als Browserquelle mit 1280 × 720 Pixeln eingetragen. Mit `?speed=0.5` läuft die Vorführung doppelt so schnell.

Enthalten sind Gen-5-Front- und Rückensprites, klassische versetzte KP-Felder, Teamleisten, prozentuales Schadensfeedback, Statusanzeigen sowie Treffer-, Wechsel-, K.-o.- und universelle typabhängige Attackeneffekte. Die Kampflogik bleibt unverändert v1.4.
