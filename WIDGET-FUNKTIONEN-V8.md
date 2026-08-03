# Widget-Funktionen v8

## Direkt bedienbar

- Lager-Menü: Bericht, ins Team, Item verwenden, Freilassen
- Team-Menü: Bericht, auf PC ablegen, Item verwenden, aktiv setzen
- Bericht: Sprite, Name, Dex-ID, Level, XP, Seltenheit, Fangdatum sowie vorbereitete Bereiche für Attacken und Statuswerte
- Items: Zielauswahl aus dem Team, Bestätigung und Mengenwahl für XP-Bonbons
- XP-Bonbons können auf jedes eigene Pokémon angewendet werden, auch wenn es nicht aktiv ist
- Home: wechselnde Begrüßung und Rangplätze für Fänge, verschiedene Pokémon und PvP-Kämpfe
- Multi: zeigt ausschließlich Spieler, die in den vergangenen 30 Minuten im Twitch-Chat geschrieben haben

## Bewusst vorbereitet, aber noch nicht vollständig

- Entwicklungssteine benötigen noch den gezielten Evolutionsdialog für ein frei gewähltes Pokémon.
- Attacken und Statuswerte erscheinen, sobald diese Daten im Kampfmodell gespeichert werden.
- PvP, Kampfanimation, Tauschanimation und eine zeitlich gesteuerte Overlay-Aktivitätsqueue sind der nächste Funktionsblock. Die bestehende Bot-Befehlsqueue serialisiert bereits Serverbefehle, ersetzt aber noch keine Animationsqueue.
- Vor öffentlicher Nutzung müssen schreibende Widget-Aktionen eine serverseitig verifizierte Twitch-Identität verwenden; `userId` als URL-Parameter ist nur für die Entwicklungsphase gedacht.
