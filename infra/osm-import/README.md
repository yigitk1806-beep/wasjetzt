# Eigene Ortsdatenbank

WasJetzt liest Orte aus freien OpenStreetMap-Auszügen von
[Geofabrik](https://download.geofabrik.de) und legt sie in der eigenen
Datenbank ab. Für importierte Gebiete geht danach keine Anfrage mehr an
fremde Server.

## Warum

Die öffentlichen Overpass-Instanzen sind gespendete Infrastruktur und
tragen die Last nicht. Am 04.11.2026 gemessen, von Vercel aus:

| Server | Ergebnis |
| --- | --- |
| overpass-api.de | Zeitüberschreitung nach 12 s |
| overpass.kumi.systems | Zeitüberschreitung nach 12 s |
| overpass.private.coffee | Zeitüberschreitung nach 12 s |

Alle drei, seit dem 20.10.2026 ununterbrochen — fünfzehn Tage. Die App
konnte in dieser Zeit in jeder Gegend, die nicht im Zwischenspeicher lag,
keinen einzigen Plan bauen. Das ist kein Fehler, den man wegprogrammiert:
Die Quelle trägt nicht.

Ein Geofabrik-Auszug kostet nichts, ist täglich neu und liegt nach dem
Import in derselben Datenbank, in der die Pläne schon liegen.

## Was es kostet

Für Berlin gemessen, nicht geschätzt (Auszug vom 03.11.2026):

```
7.915.427 Knoten, 1.340.096 Wege im Auszug (95,3 MB)
   18.130 brauchbare Orte mit Namen
      609 davon ausschließlich Sehenswürdigkeit (Kirchen, Brücken, Denkmäler)
      105 als Glücksspiel markiert — gespeichert und gesperrt, nicht entfernt
   ~8,4 MB in der Datenbank
     17 s Laufzeit
```

Neon Free erlaubt 1 GB. Berlin passt also etwa hundertfach hinein; ganz
Deutschland wäre nach dieser Messung in der Größenordnung von 400 MB und
damit auch noch drin.

## Benutzung

Zwei Schritte. Beide brauchen Node 24 oder neuer — die Skripte laden die
TypeScript-Dateien der App direkt und entfernen nur die Typen.

```bash
# 1. Auszug holen (prüft die Prüfsumme und übernimmt den Stand des Servers)
node --experimental-strip-types infra/osm-import/holen.mts europe/germany/berlin

# 2. Importieren
node --env-file=.env --import ./infra/aliasHaken.mjs --experimental-strip-types \
  infra/osm-import/importieren.mts \
  .osm/europe-germany-berlin-latest.osm.pbf europe/germany/berlin
```

Gebiete heißen wie bei Geofabrik: `europe/germany/berlin`,
`europe/germany/hamburg`, `europe/germany` für das ganze Land. Die Liste
steht unter <https://download.geofabrik.de>.

`--trocken` rechnet alles durch und schreibt nichts:

```bash
node --import ./infra/aliasHaken.mjs --experimental-strip-types \
  infra/osm-import/importieren.mts .osm/berlin.osm.pbf europe/germany/berlin --trocken
```

Und nur messen, ohne Datenbank:

```bash
node --import ./infra/aliasHaken.mjs --experimental-strip-types \
  infra/osm-import/messen.mts .osm/berlin.osm.pbf
```

### Nach dem Import

`/api/health` zeigt jedes importierte Gebiet mit seinem Stand und dem Alter
in Tagen. Das ist Absicht: Die eigene Datenbank antwortet schnell und ohne
fremdes Netz, aber sie ist genau so aktuell wie der letzte Auszug. Ein
stillschweigend ein Jahr alter Bestand wäre schlimmer als ein langsamer
Server.

```bash
curl https://wasjetzt-three.vercel.app/api/health | jq .ortsdaten
```

### Abschalten

`WASJETZT_EIGENE_ORTE=0` schaltet die eigene Datenbank ab, ohne sie zu
leeren. Dann läuft alles wieder über Overpass — nützlich, um die
Ausfallwege zu prüfen.

## Die Dateien

| Datei | Aufgabe |
| --- | --- |
| `holen.mts` | Auszug herunterladen, Prüfsumme vergleichen, Stand übernehmen |
| `pbfLeser.mts` | PBF lesen — Protobuf und zlib, ohne fremde Abhängigkeit |
| `importieren.mts` | Klassifizieren und in die Datenbank schreiben |
| `messen.mts` | Nur zählen, nichts schreiben |

## Was hier bewusst nicht passiert

**Klassifizieren.** Welches Profil ein Ort bekommt, entscheidet
`providers/osm/taxonomy.ts` beziehungsweise `providers/osm/sights.ts` —
dieselben Dateien, die auch die Overpass-Antworten verarbeiten. Gespeichert
werden die **rohen OSM-Tags**; die Umwandlung in einen `Place` macht
`providers/osm/osmToPlace.ts`, für beide Quellen dieselbe Funktion.

Das ist der wichtigste Punkt an der ganzen Konstruktion. Zwei Umwandlungen
zu pflegen hieße, dass sie auseinanderlaufen — und dann wäre ein Ort je
nach Tagesform des Overpass-Servers eine Spielhalle oder eben nicht.

**Erfinden.** Ein Ort ohne Namen wird nicht benannt, ein fehlender Preis
nicht geschätzt, eine fehlende Öffnungszeit nicht ergänzt. Von den 18.130
Berliner Orten haben 9.328 Öffnungszeiten in OSM; die anderen zeigen
„Öffnungszeiten nicht verfügbar", und dabei bleibt es.

**Relationen.** Der Leser liest Knoten und Wege, keine Relationen. Für
Ortsdaten reicht das: Die Probe an sechs Berliner Wahrzeichen ging auf, der
Fernsehturm liegt 3 m und der Berliner Dom 13 m von seiner bekannten Stelle.
Sollte sich zeigen, dass Orte fehlen, die nur als Relation erfasst sind, ist
das die nächste Ausbaustufe — und keine, die sich raten lässt. Dann wird
gemessen.

## Test

```bash
node --import ./infra/aliasHaken.mjs --experimental-strip-types \
  infra/tests/ortsdaten.mts
```

Braucht den Berlin-Auszug unter `.osm/`. Prüft an nachprüfbaren Tatsachen —
bekannte Wahrzeichen an ihren bekannten Koordinaten —, nicht an Zahlen, die
der Test sich selbst ausgerechnet hat. Siehe `infra/tests/README.md`.
