# Eigene Overpass-Instanz

## Warum

WasJetzt holt alle Orte aus OpenStreetMap über Overpass. Bisher über die
öffentlichen Instanzen – gespendete Infrastruktur, die unter Last spät oder
gar nicht antwortet. Gemessen am 24.09.2026 auf einem Entwicklungsrechner:

```
[overpass] primär/öffentlich overpass-api.de fehler 7609ms
[overpass] ausweich/öffentlich overpass-api.de ok 8573ms · 419 Orte · gesamt 17694ms
```

17,7 Sekunden – über dem Zeitbudget von 14 Sekunden, das eine Planung höchstens
brauchen darf. Die Folge ist im Plan sichtbar: WasJetzt weicht auf Demo-Daten
aus und kennzeichnet sie als solche. Für echten Betrieb ist das nicht tragbar.

Eine eigene Instanz beantwortet dieselbe Abfrage aus lokalen Daten, ohne
Warteschlange und ohne Ratenbegrenzung.

## Architektur

```
WasJetzt (Vercel)
   │
   ├─ OVERPASS_PRIMARY_URL   → eigene Instanz        (wenn gesetzt)
   │        │ Fehler oder Zeitüberschreitung
   │        ▼
   └─ OVERPASS_FALLBACK_URL  → öffentliche Instanz   (oder die eingebaute Liste)
            │ auch das scheitert
            ▼
        bisheriges Verhalten: ehrliche Meldung bzw. gekennzeichnete Demo-Daten
```

Beide Variablen sind optional. Sind sie leer, verhält sich die App exakt wie
vor dieser Änderung – die eingebaute Liste öffentlicher Instanzen wird der
Reihe nach gefragt. Die Umstellung kann deshalb jederzeit zurückgenommen
werden, ohne ein Deployment zurückzurollen: Variable leeren, neu deployen.

Zuständig im Code:

| Datei | Aufgabe |
|---|---|
| `providers/osm/overpassEndpoints.ts` | Reihenfolge, Zeitgrenzen, Erreichbarkeitstest |
| `providers/osm/overpassPlaceProvider.ts` | Abfrage, Wiederholung, Protokoll |
| `app/api/health/route.ts` | `?overpass=1` meldet den Zustand jedes Ziels |

Die Abfragen selbst (`providers/osm/taxonomy.ts`) sind unverändert. Eine eigene
Overpass-Instanz spricht dieselbe Sprache wie die öffentliche.

## Voraussetzungen

Die Instanz gehört **nicht** auf Vercel. Dort laufen keine dauerhaften Dienste
und es gibt keinen persistenten Speicher. Gebraucht wird ein eigener Server.

Für den Startbereich Berlin, geschätzt anhand der Größe des Auszugs –
**vor dem Bestellen am eigenen Import nachmessen**:

| | |
|---|---|
| CPU | 2 Kerne |
| RAM | 4 GB (Import ist der Engpass, Betrieb braucht weniger) |
| Platte | 20 GB SSD |
| Betriebssystem | beliebig mit Docker ≥ 24 und Compose v2 |
| Ports nach außen | nur 443 (HTTPS über einen Reverse Proxy) |

Der Container selbst bindet absichtlich nur an `127.0.0.1` – siehe *Betrieb*.

## Start

```bash
cp infra/overpass/.env.example infra/overpass/.env   # anpassen, optional
docker compose -f infra/overpass/docker-compose.yml up -d
docker compose -f infra/overpass/docker-compose.yml logs -f overpass
```

Beim **ersten** Start lädt der Container den Auszug und baut die Datenbank.
Das dauert – für Berlin nach Erfahrungswerten des Abbilds grob 20 bis 60
Minuten, je nach Platte. Währenddessen antwortet `/api/status` noch nicht;
der Healthcheck hat deshalb 60 Minuten Anlaufzeit.

Danach:

```bash
curl "http://localhost:12345/api/status"
```

## OSM-Daten

| | |
|---|---|
| Quelle | https://download.geofabrik.de/europe/germany/berlin-latest.osm.bz2 |
| Abdeckung | Land Berlin, vollständig, inklusive eines schmalen Randes Brandenburgs |
| Format | `.osm.bz2`, tägliche Neuerstellung durch Geofabrik |
| Importdatum | steht im Volume unter `/db/`, außerdem meldet `/api/status` den Stand |

Bewusst **nicht** der ganze Planet: Der bräuchte über ein Terabyte und Tage an
Importzeit. Berlin ist die Region, in der WasJetzt heute benutzt wird.

**Weitere Regionen später:** Geofabrik bietet Auszüge je Bundesland, Land und
Kontinent. Für mehr Abdeckung wird `OVERPASS_PLANET_URL` auf einen größeren
Auszug gesetzt (z. B. `europe/germany-latest.osm.bz2`, rund 4 GB) und das
Volume neu angelegt. Der Code muss dafür nicht angefasst werden – er kennt
keine Regionen, nur einen Endpunkt.

## Aktualisierung

OSM ändert sich täglich. Zwei Wege:

**A – Automatisch (empfohlen, sobald die Instanz steht).**
In `infra/overpass/.env`:

```
OVERPASS_DIFF_URL=https://download.geofabrik.de/europe/germany/berlin-updates/
OVERPASS_UPDATE_SLEEP=3600
```

Der Container holt dann stündlich die Änderungsdateien und spielt sie ein.
Das ist der eingebaute Weg des Abbilds; er ist in diesem Projekt **noch nicht
erprobt** – `OVERPASS_DIFF_URL` ist standardmäßig leer.

**B – Neu importieren.**
Volume löschen, Container neu starten. Einfach, aber mit Ausfallzeit:

```bash
docker compose -f infra/overpass/docker-compose.yml down
docker volume rm wasjetzt-overpass-db
docker compose -f infra/overpass/docker-compose.yml up -d
```

Während eines Neuimports greift automatisch der öffentliche Fallback – die App
bleibt benutzbar, nur langsamer.

## Konfiguration in WasJetzt

In `.env` (lokal) bzw. in den Vercel-Umgebungsvariablen:

```
OVERPASS_PRIMARY_URL=https://overpass.example.org/api/interpreter
OVERPASS_PRIMARY_TIMEOUT_MS=6000
OVERPASS_FALLBACK_URL=
```

`OVERPASS_FALLBACK_URL` leer lassen heißt: die eingebaute Liste öffentlicher
Instanzen wird als Auffangnetz benutzt. Das ist der gewünschte Zustand.

Die Zeitgrenze von 6 Sekunden ist bewusst knapp. Die eigene Instanz antwortet
aus lokalen Daten; braucht sie länger, ist etwas kaputt, und die Zeit ist beim
öffentlichen Server besser angelegt als in weiterem Warten.

## Healthcheck

**Von außen, über die App:**

```bash
curl "https://wasjetzt-three.vercel.app/api/health?overpass=1"
```

```json
"overpass": [
  { "art": "eigen",       "host": "overpass.example.org", "status": "healthy", "ms": 38 },
  { "art": "öffentlich",  "host": "overpass-api.de",      "status": "healthy", "ms": 265 }
]
```

Zustände: `healthy`, `unhealthy` (antwortet, aber falsch), `timeout`.

**Am Server:**

```bash
curl "http://localhost:12345/api/status"
docker compose -f infra/overpass/docker-compose.yml ps   # Spalte STATUS
```

## Protokoll

Jeder Versuch schreibt eine Zeile. Ohne sie ist von außen nicht zu erkennen,
ob die eigene Instanz trägt oder ob jede Anfrage still ausweicht:

```
[overpass] primär/eigen overpass.example.org ok 5ms · 312 Orte
[overpass] primär/eigen overpass.example.org zeitüberschreitung 6001ms
[overpass] ausweich/öffentlich overpass-api.de ok 2140ms · 419 Orte · gesamt 8150ms
```

Enthalten sind Rolle, Art, Host, Ergebnis und Dauer – keine Koordinaten, keine
Abfragen, keine Nutzerdaten.

## Messen statt behaupten

```bash
node infra/overpass/bench.mjs http://localhost:12345/api/interpreter
node infra/overpass/bench.mjs http://localhost:12345/api/interpreter \
     --vergleich https://overpass-api.de/api/interpreter
```

Gemessen werden kalte Abfrage, warme Abfragen und 5/10/20 parallele Anfragen
mit Fehlerquote, Mittel, Median und der langsamsten Antwort.

Gegen fremde Instanzen laufen nur die kleinen Stufen – die öffentlichen Server
sollen von diesen Tests nicht belastet werden.

**Erst umstellen, wenn die Zahlen es hergeben.** Eine einzelne schnelle
Anfrage ist kein Beweis; es zählen Fehlerquote und Maximalzeit unter Last.

## Betrieb

**HTTPS und Zugang.** Der Container bindet an `127.0.0.1`. Davor gehört ein
Reverse Proxy (Caddy, nginx, Traefik) mit einem Zertifikat. Nur `/api/interpreter`
und `/api/status` müssen erreichbar sein.

**Ratenbegrenzung.** Im Reverse Proxy, nicht in Overpass. Ein Vorschlag als
Ausgangspunkt: 30 Anfragen pro Minute je IP. WasJetzt selbst fragt pro Plan
höchstens drei Mal.

**Firewall.** Nach außen nur 443 (und 22 für die Verwaltung, am besten nur mit
Schlüssel und von bekannten Adressen).

**Keine Geheimnisse.** Overpass kennt keine Zugangsdaten. `infra/overpass/.env`
enthält nur Adressen und Grenzen und ist trotzdem über `.gitignore`
ausgeschlossen – damit dort auch versehentlich nichts landet.

## Sicherung

Die Datenbank ist abgeleitet: Sie lässt sich jederzeit aus dem Geofabrik-Auszug
neu erzeugen. Eine Sicherung spart nur die Importzeit.

```bash
docker run --rm -v wasjetzt-overpass-db:/db -v "$PWD:/sicherung" alpine \
  tar czf /sicherung/overpass-db.tar.gz -C /db .
```

## Überwachung

Mindestens: ein Aufruf von `/api/health?overpass=1` alle paar Minuten und eine
Meldung, wenn `art: "eigen"` nicht mehr `healthy` ist. Solange der Fallback
greift, merkt der Nutzer nichts – und genau deshalb fällt es sonst niemandem
auf.

## Wenn etwas klemmt

| Symptom | Ursache | Abhilfe |
|---|---|---|
| `/api/status` antwortet nicht, Container läuft | Import läuft noch | `logs -f overpass`; Berlin braucht 20–60 Minuten |
| Import bricht ab | Speicher zu klein | `OVERPASS_MEMORY_LIMIT` anheben, Volume löschen, neu starten |
| Abfragen dauern über 6 s | Instanz überlastet oder zu wenig RAM | `OVERPASS_SPACE` und RAM prüfen |
| `status: "unhealthy"` mit HTTP 400 | Abfrage abgelehnt | `OVERPASS_MAX_TIMEOUT` prüfen |
| Protokoll zeigt immer `ausweich` | Primary nicht erreichbar | Adresse, Proxy, Zertifikat und Firewall prüfen |
| Ergebnisse sind veraltet | Kein Update eingerichtet | `OVERPASS_DIFF_URL` setzen oder neu importieren |

## Stand

Was in diesem Projekt **fertig und erprobt** ist:

- Umschaltung Primary → Fallback, mit Protokoll und Zeitgrenzen
- Erreichbarkeitstest über `/api/health?overpass=1`
- Verhalten ohne gesetzte Variablen: unverändert
- Messwerkzeug für den Vergleich

Was **noch aussteht** und einen Server braucht:

- die Instanz tatsächlich aufsetzen (Docker Compose liegt bereit)
- den Berlin-Import durchführen und die Dauer nachmessen
- Reverse Proxy mit HTTPS, Ratenbegrenzung, Firewall
- Messreihe eigene gegen öffentliche Instanz
- danach `OVERPASS_PRIMARY_URL` in Vercel setzen
- automatische Aktualisierung einrichten und erproben
