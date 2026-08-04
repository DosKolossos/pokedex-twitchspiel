# Kampflabor v1

## Enthalten

- 25 Wesen mit deutschen und englischen Eingaben (inklusive `massig`)
- offizielle Statuswertformel mit 31 IV, 0 EV und aktuellem Level
- sichtbare Wesen- und Statuswertanzeige im Pokémon-Bericht
- zufälliges, dauerhaftes Wesen bei neuen Fängen
- Twitch-Belohnung `Wesen ändern` für das aktive Pokémon
- isoliertes 3-gegen-3-Kampflabor im Multiplayer-Menü
- erste Angriffs-, Status- und Wechselbewertung
- reproduzierbare Simulationen durch einen sichtbaren Seed

Das Kampflabor schreibt weder Ergebnisse noch KP in Spielerdaten. Es ist bewusst ein Testmodus.

## Einmalig nach dem Deployment

Bestehenden Exemplaren zufällige Wesen geben:

```bash
cd /opt/pokedex
npm run assign:natures
```

Das Skript legt vor dem Schreiben Sicherungskopien von `pokedex.json` und `profiles.json` an. Bei einem zweiten Aufruf werden bereits zugewiesene Wesen nicht verändert.

Danach Prozesse neu starten:

```bash
pm2 restart pokedex-bot pokedex-overlay pokedex-web-sync --update-env
```

## Test

```bash
cd /opt/pokedex
npm run test:battle
```

Im Widget: **Multi → Kampflabor**. Jeder Klick auf **Neu simulieren** erzeugt einen neuen Testkampf.

Die Twitch-Belohnung muss exakt `Wesen ändern` heißen und eine Texteingabe verlangen. Beispiele: `Mäßig`, `Modest`, `Hart`, `Adamant`, `Scheu` oder `Timid`.

Hinweis: Twitch kann das automatische Abschließen bzw. Erstatten einer manuell im Dashboard angelegten Belohnung je nach API-Eigentümerschaft ablehnen. Die Wesen-Änderung funktioniert trotzdem; bei ungültigen Eingaben fordert der Bot dann zum manuellen Ablehnen auf.
