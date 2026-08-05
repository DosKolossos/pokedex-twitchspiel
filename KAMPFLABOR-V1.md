# Kampflabor v1.3

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

## Entscheidungslogik v1.3

- Erzwungene Einwechslungen werden vor der nächsten Aktionswahl vollständig abgehandelt.
- Ein K.-o. verwirft die noch geplante Aktion des besiegten Pokémon.
- Immunitäten verursachen exakt 0 Schaden; wirkungslose Statusattacken werden erkannt.
- Ein Wechsel wird mit dem erwarteten Treffer auf das eingewechselte Pokémon bewertet.
- Schnelle Pokémon nutzen möglichen freien Schaden, bevor sie unnötig wechseln.
- Fragile Pokémon werden nicht in einen prognostizierten K.-o. eingewechselt.
- Wiederholte Wechsel kurz hintereinander erhalten eine zusätzliche Wechselhürde.
- Der strategische Restwert schützt mögliche Winconditions gegen das verbleibende Team.
- Speed-Ties werden bei der tatsächlichen Zugreihenfolge 50/50 aufgelöst.

Das Labor besitzt absichtlich vollständige Informationen. Das Wissensmodell für echtes PvP
(bekanntes Team, gesichtete Attacken und nur vermutete Coverage) folgt mit der PvP-Anbindung.

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

## KI-Analyse mit zehn unterschiedlichen Kämpfen

```bash
npm run analyze:battles
```

Der Befehl simuliert zehn feste 3-gegen-3-Szenarien mit unterschiedlichen Teams und reproduzierbaren Seeds. Pikachu bleibt ausdrücklich Teil mehrerer Tests. Ausgegeben werden die vollständigen Zugfolgen sowie bei Wechseln die prognostizierte beste Attacke, deren erwarteter Schaden und der erwartete Gegenschaden. Das Ziel ist nicht eine ausgeglichene Siegquote, sondern das Erkennen unplausibler Angriffe, Statuszüge, Einwechslungen und Wechselketten.

Im Widget: **Multi → Kampflabor**. Jeder Klick auf **Neu simulieren** erzeugt einen neuen Testkampf.

Die Twitch-Belohnung muss exakt `Wesen ändern` heißen und eine Texteingabe verlangen. Beispiele: `Mäßig`, `Modest`, `Hart`, `Adamant`, `Scheu` oder `Timid`.

Hinweis: Twitch kann das automatische Abschließen bzw. Erstatten einer manuell im Dashboard angelegten Belohnung je nach API-Eigentümerschaft ablehnen. Die Wesen-Änderung funktioniert trotzdem; bei ungültigen Eingaben fordert der Bot dann zum manuellen Ablehnen auf.
