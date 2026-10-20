# Regressionstests

Eigenständige Node-Skripte gegen einen laufenden Entwicklungsserver. Es gibt
in diesem Projekt bewusst keinen Testläufer: Die Skripte prüfen das Verhalten
der fertigen API und der Karte, nicht einzelne Funktionen.

Jedes Skript endet mit `Exit-Code 1`, wenn ein Fall fehlschlägt oder der
Server nicht erreichbar ist. Ein nicht erreichbarer Server erzeugt eine
lesbare Meldung mit der verwendeten Adresse, keinen Stacktrace.

## Voraussetzungen

* Node 20 oder neuer (die Skripte benutzen `fetch` und Top-Level-`await`)
* `npm install` ist gelaufen
* ein laufender Entwicklungsserver — welcher, steht je Test unten

Die Basisadresse lässt sich überall über `BASIS` setzen, zum Beispiel
`BASIS=http://localhost:3123 node infra/tests/route-linie.mjs`.

## Deterministisch: Glücksspiel

Diese Tests sichern eine Produktzusage ab — WasJetzt empfiehlt kein
Glücksspiel, unabhängig von Alter, Stimmung und Wunsch. Sie dürfen deshalb
nicht an der Tagesform öffentlicher Overpass-Server hängen und laufen gegen
eine Attrappe mit festen Fixtures.

Drei Schritte, in drei Terminals oder nacheinander im Hintergrund:

```bash
# 1. Attrappe starten (Port 3999)
node infra/tests/overpass-stub.mjs

# 2. Entwicklungsserver gegen die Attrappe (Port 3124)
OVERPASS_PRIMARY_URL=http://localhost:3999/api/interpreter \
OVERPASS_FALLBACK_URL=http://localhost:3999/api/interpreter \
WASJETZT_DEMO_ORTE=0 \
npx next dev --port 3124

# 3. Test
node infra/tests/gluecksspiel.mjs
```

Der Server muss **nach** der Attrappe starten, und nach jeder Änderung an den
Fixtures neu: Die Ortsdaten liegen 24 Stunden im Zwischenspeicher.

Die Attrappe beantwortet jede Anfrage mit denselben neunzehn Orten, ganz
gleich, wonach gefragt wurde. Die Fixtures tragen neutrale Namen, weil die
Zuordnung über die OSM-Tags geprüft wird und nicht über eine Namensliste:

| Fixture | Tags | erwartet |
| --- | --- | --- |
| Videohalle Nord | `leisure=amusement_arcade` | erlaubt |
| Kegelbahn West | `leisure=bowling_alley` | erlaubt |
| Minigolf Mitte | `leisure=miniature_golf` | erlaubt |
| Sprungbude Nord | `leisure=trampoline_park` | erlaubt |
| Ehrliche Kneipe | `amenity=pub` + `gambling=no` | erlaubt |
| Automatenhof Sued | `leisure=adult_gaming_centre` | gesperrt |
| Grosse Spielbank | `amenity=casino` | gesperrt |
| Sportpalast Ost | `leisure=sports_centre` + `amenity=casino` | gesperrt |
| Tippstube Sued | `leisure=sports_centre` + `shop=bookmaker` | gesperrt |
| Kurhaus Alt | `tourism=attraction` + `amenity=casino` | gesperrt |

Die letzten drei sind der Kern: Sie kommen über ein harmloses Zweit-Tag
herein. Eine gekürzte Overpass-Abfrage allein hielte sie nicht auf.

Geprüft werden Stimmung „Action", Kachel „Gaming", fünf Freitextvarianten,
Familien mit Kind, „Station ersetzen", Alternativpläne, Touren, die Diagnose
und die erzeugte Overpass-Abfrage.

### Touren mit echten Daten

```bash
npm run dev            # Port 3000
node infra/tests/tour-gluecksspiel.mjs
```

Ergänzt den deterministischen Teil um eine Tour aus echten Ortsdaten.
**Braucht Overpass und OSRM.** Fällt eine der Quellen aus, meldet der Test
„nicht messbar" statt zu bestehen.

## Externe Daten: Routenlinien

```bash
npm run dev            # Port 3000
node infra/tests/route-linie.mjs
```

Prüft, dass die Karte die echte Straßenführung zeichnet und keine gerade
Verbindung: mehr als zwei Stützpunkte je Weg, länger als die Luftlinie,
unverändert nach dem Speichern. Dazu der ÖPNV-Fall — dafür hat OSRM kein
Profil, also sind dort alle Wege geschätzt und dürfen keine Geometrie
erfinden.

**Braucht Overpass und OSRM.** Antwortet OSRM gerade nicht, sind die Wege
geschätzt und die Fälle melden „nicht messbar".

### Nicht automatisiert: die Zeichenreihenfolge

Die Korrektur in `components/plan/PlanMap.tsx` betrifft die Reihenfolge, in
der Leaflet zeichnet: erst alle weißen Ränder, dann alle farbigen Linien.
Wurden Rand und Linie je Teilstrecke zusammen gezeichnet, legte sich der
7 px breite Rand der nächsten Strecke über die 4 px schmale Linie der
vorigen, und die Route riss an jeder Station auf.

**Dieser Teil ist nicht automatisiert.** Im Projekt ist keine Browser- oder
DOM-Umgebung installiert — kein Playwright, kein Puppeteer, kein jsdom — und
Leaflet zeichnet erst im Browser. Eine Prüfung, die die erwartete Reihenfolge
aus einer vorbereiteten Datei abliest, wäre ein Schein-Test: Sie bestünde
auch dann, wenn die Karte kaputt ist. Deshalb gibt es sie hier nicht.

Von Hand, in der Browserkonsole auf einer Plan- oder Tourseite:

```js
[...document.querySelectorAll('.leaflet-overlay-pane path')]
  .map(p => p.getAttribute('stroke'))
```

Erwartet: erst alle `#ffffff`, danach alle farbigen. Ein `#ffffff` **nach**
einer farbigen Linie ist der Fehler.

Soll das automatisch laufen, braucht es Playwright oder Puppeteer als
Entwicklungsabhängigkeit. Das ist bewusst nicht ungefragt hinzugefügt worden.

## Verhalten bei nicht erreichbarem Server

```
Server nicht erreichbar: http://localhost:3000
Grund: fetch failed
Starte ihn mit `npm run dev` (Port 3000) oder setze BASIS, z. B.
  BASIS=http://localhost:3123 node infra/tests/route-linie.mjs
```

Exit-Code 1. Kein Fall wird als bestanden gezählt.

## Was die Ergebniszeile bedeutet

```
==== 30 PASS / 0 FAIL ====
```

`PASS` und `FAIL` sind gemessene Aussagen. `nicht messbar` heißt: Der Fall
konnte nicht geprüft werden, weil Daten fehlten — er gilt weder als bestanden
noch als gescheitert. Das ist Absicht: Ein Test, der bei fehlenden Daten
durchwinkt, ist schlimmer als keiner.
