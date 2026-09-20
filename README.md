# WasJetzt

**Mehr erleben. Weniger planen.**

WasJetzt beantwortet die Frage „Was machen wir jetzt?“ – nicht mit einer Suchmaske,
sondern mit einem fertigen Plan: Essen → Aktivität → Ausklang, mit echten Orten,
Uhrzeiten, Wegen und Rückweg.

```bash
npm install
npm run dev
```

→ http://localhost:3000 — ohne Konfiguration, ohne API-Schlüssel, ohne Datenbank.

---

## Datenquellen: was echt ist und was nicht

Das ist die wichtigste Tabelle dieses Projekts, und sie ist auch in der App sichtbar.

| Daten | Quelle | Schlüssel nötig | Status |
|---|---|---|---|
| Orte (Name, Art, Position) | OpenStreetMap via Overpass | nein | **echt** |
| Öffnungszeiten | OpenStreetMap `opening_hours` | nein | **echt, wenn vorhanden** |
| Eintrittspreise | OpenStreetMap `fee` / `charge` | nein | **echt, wenn vorhanden** |
| Preisniveau € / €€ / €€€ | aus der Art des Ortes abgeleitet | – | **Schätzung, als solche gekennzeichnet** |
| Wetter + Stundenvorhersage | Open-Meteo | nein | **echt** |
| Ortssuche (Städte) | Open-Meteo Geocoding | nein | **echt** |
| Reisezeiten Fuß/Rad/Auto | OSRM (FOSSGIS) | nein | **echt** |
| Reisezeiten ÖPNV | Luftlinie × Umwegfaktor | – | **Schätzung, als „ca.“ ausgewiesen** |
| Kartenkacheln | OpenStreetMap | nein | **echt** |
| Bewertungen | – | – | **gibt es nicht** |
| Demo-Orte | eigener Generator | – | **nur als Notfall-Fallback** |

### Die Regeln dahinter

* **Keine erfundenen Preise.** Ein Eurobetrag erscheint nur, wenn OpenStreetMap ihn
  angibt (`fee=no`, `charge=5 EUR`). Sonst steht dort € / €€ / €€€ mit dem Zusatz
  „geschätzt“. Ein Plan zeigt eine Gesamtsumme in Euro nur, wenn **jeder** Schritt
  einen echten Preis hat – sonst nur das Niveau. Aus Schätzungen wird keine
  Scheingenauigkeit gemacht.
* **Keine erfundenen Öffnungszeiten.** Fehlt das Tag oder ist es zu komplex für den
  Parser, steht am Schritt „Öffnungszeiten nicht verfügbar“. Solche Orte werden im
  Ranking abgewertet und nachts gar nicht erst vorgeschlagen – aber nie als offen
  ausgegeben.
* **Keine Bewertungen.** OSM hat keine, also zeigt die App keine.
* **„ca.“ steht nur dort, wo wirklich geschätzt wird.** Fuß-, Rad- und Autowege
  kommen aus echtem Routing und erscheinen ohne „ca.“. Für den ÖPNV gibt es kein
  offenes Routing-Profil – diese Wege bleiben geschätzt und behalten das „ca.“.
  Eine Autoroute als Bahnfahrt auszugeben wäre die bequemere, aber falsche Lösung.
* **Demo-Daten nur bei technischem Ausfall.** Ein *leeres* Ergebnis von OpenStreetMap
  wird nicht durch erfundene Orte überdeckt – „hier ist nichts erfasst“ ist eine
  korrekte Auskunft. Nur wenn keine Overpass-Instanz erreichbar ist, springt der
  Generator ein, und der Plan trägt dann sichtbar den Demo-Hinweis.

---

## Was funktioniert

| Bereich | Status |
|---|---|
| Startseite mit drei Aktionen (Jetzt los / Plan erstellen / Überrasch mich) | ✅ |
| Standort per GPS oder Ortssuche | ✅ |
| Echte Orte aus OpenStreetMap | ✅ |
| Plan Engine: harte Filter → Ranking → Zeitplan | ✅ |
| Wetter, Jahreszeit, Tageszeit, Öffnungszeiten, Reisezeiten | ✅ |
| Planvarianten (Ausgewogen / Romantisch / Action / Günstig) | ✅ |
| Einzelne Aktivität ersetzen, Rest bleibt stehen | ✅ |
| „Nur eine Sache“, „Zuhause bis X Uhr“ (Rückwärtsplanung) | ✅ |
| Freitext verstehen („Wir sind zu zweit, 50 €, was Verrücktes“) | ✅ regelbasiert |
| Karte mit OSM-Kacheln, Markern, Route + Navigation | ✅ |
| Plan teilen, Teilnehmer, Zu-/Absagen, Treffpunkt, Voting | ✅ |
| Lernen aus Feedback und Ablehnungen, Routine-Erkennung | ✅ lokal im Browser |
| Persistenz in Postgres | ✅ sobald `DATABASE_URL` gesetzt ist |
| Mehrsprachigkeit | 🟡 de + en vollständig, 4 weitere vorbereitet |
| Echtes Routing (Fuß/Rad/Auto) | ✅ OSRM, ohne Schlüssel |
| Echtes Routing ÖPNV | ⛔ kein offenes Profil verfügbar |
| Straßengenaue Linie auf der Karte | ⛔ direkte Verbindung |
| Events, Buchungen, Partner-Portal | ⛔ Architektur vorbereitet |

---

## Geschwindigkeit

Die öffentlichen Overpass-Instanzen sind gespendete Infrastruktur und schwanken
stark – dieselbe Abfrage brauchte in Messungen zwischen 4 und 21 Sekunden. Damit
„⚡ Jetzt los“ trotzdem sofort reagiert:

1. **Vorladen.** Sobald der Standort bekannt ist, lädt die Startseite die Umgebung
   im Hintergrund (`/api/prefetch`) – während der Nutzer noch die Überschrift liest.
2. **Cache.** Ergebnisse werden pro ~2-km-Kachel eine Stunde lang gehalten.
3. **Zeitbudget.** Ein Klick wartet höchstens 9 Sekunden auf OpenStreetMap. Läuft es
   über, liefert der Demo-Generator sofort etwas Brauchbares, während die echte
   Abfrage im Hintergrund weiterläuft und den Cache füllt.

Routing der gewählten Wege läuft erst nach dem Planen (2–4 Abfragen statt
hunderter) und wird pro Weg zwischengespeichert.

Gemessen lokal (Hamburg): **kalt 7–9 s, warm 34–160 ms.**

Eine bekannte Grenze: In sehr dichten Innenstädten greift das Element-Limit der
Abfrage, dann kennt die App nur einen Ausschnitt der Gegend. Vollständigkeit wird
nirgends behauptet.

---

## Architektur

```
app/            Routen (App Router) + API
  api/plan      Plan erstellen, ersetzen, Gruppe, Wetterwache
  api/prefetch  Ortsdaten im Hintergrund vorladen
components/     UI, nach Bereich gruppiert
engine/         Plan Engine – kennt keine API, nur Daten
providers/      Austauschbare Datenquellen hinter Interfaces
  osm/          Overpass-Abfrage, Tag-Mapping, opening_hours-Parser
  routing/      OSRM (echt) mit geometrischer Schätzung als Rückfall
  mock/         Demo-Generator (Fallback)
db/             PlanStore: In-Memory und Prisma/Postgres
lib/            Zeit, Geo, i18n, Client-Speicher, Validierung
types/          Domänenmodell
hooks/          Standort, Wetter
```

### Provider tauschen

Alle Datenquellen liegen hinter Interfaces in `providers/types.ts`:

```
PlaceProvider · WeatherProvider · EventProvider · RoutingProvider
GeocodingProvider · BookingProvider · LanguageProvider
```

Die Engine kennt **nur** diese Interfaces. Getauscht wird an genau einer Stelle:
`providers/registry.ts`. Aktuell:

```ts
places: new FallbackPlaceProvider(
  new OverpassPlaceProvider(),   // echt
  new MockPlaceProvider(),       // nur bei Ausfall
),
```

Google Places dazunehmen heißt: `GooglePlacesProvider` schreiben, hier eintragen.
Kein anderer Code ändert sich. Die gemeinsamen Aktivitätsprofile
(`providers/activityProfiles.ts`) liefern jedem Provider dieselben Kennzahlen –
Dauer, Wetterfestigkeit, Stimmungsprofil.

### Plan Engine

Zwei getrennte Stufen, bewusst ohne KI:

1. **Harte Filter** (`engine/hardFilters.ts`) – geöffnet (oder plausibel, wenn
   unbekannt), erreichbar, bezahlbar, zeitlich machbar, Altersgrenze, Wetter
   zumutbar, nicht abgelehnt.
2. **Ranking** (`engine/scoring.ts`) – Stimmung, Entfernung, Preis, Wetter,
   Jahreszeit, Neuheit, gelernte Vorlieben, Rolle im Plan, Abwechslung,
   bestätigte Öffnungszeiten.

Darüber baut `engine/planBuilder.ts` greedy einen Zeitplan: Slot für Slot, jeweils
mit Reisezeit, Öffnungszeit und Restbudget. `engine/slots.ts` entscheidet anhand von
Tageszeit, Zeitbudget und Stimmung, wie der Abend überhaupt aussehen soll.

KI ist nur für Sprache vorgesehen (`LanguageProvider`). Der Default ist regelbasiert:
schnell, offline, kostenlos.

### Persistenz

`db/planStore.ts` wählt automatisch:

* **mit `DATABASE_URL`** → `PrismaPlanStore` in Postgres, gespiegelt in den
  Arbeitsspeicher. Geteilte Links leben 7 Tage. Fällt die Datenbank aus, behält
  der Nutzer seinen Plan – nur eben flüchtig, und der Fehler steht im Log.
* **ohne** → `InMemoryPlanStore`, 24 Stunden, weg beim Serverneustart

Die App zeigt im Teilen-Dialog das tatsächliche Ablaufdatum an, egal welcher
Speicher aktiv ist.

Nutzerdaten (Vorlieben, Standort, Verlauf) liegen ausschließlich im `localStorage`
des Browsers – kein Konto, kein Server-Abgleich. Löschbar unter
**Profil → Alle Daten löschen**.

---

## Deployment (Vercel + Neon)

Alles ist vorbereitet; diese Schritte brauchen deine eigenen Konten:

1. **Neon-Datenbank anlegen** → Connection String kopieren (die *pooled* Variante).
2. **Repo zu GitHub pushen.**
3. **Vercel:** Projekt aus dem Repo importieren. Framework wird automatisch erkannt.
4. **Umgebungsvariable in Vercel setzen:**
   `DATABASE_URL` = der Neon Connection String
5. **Schema einspielen** – einmalig, lokal:
   ```bash
   DATABASE_URL="<neon-url>" npm run db:push
   ```
   Falls das mit der gepoolten URL scheitert, dafür einmal die *direct*-URL aus dem
   Neon-Dashboard verwenden.
6. **Deploy.** `postinstall` ruft `prisma generate` automatisch auf.

Ohne `DATABASE_URL` startet die App trotzdem – dann eben mit flüchtigen Plänen.

Weitere Schlüssel werden **nicht** gebraucht: Wetter, Ortssuche und OpenStreetMap
laufen ohne Registrierung.

---

## Mehrsprachigkeit

`lib/i18n/dictionaries.ts`. Deutsch ist die Referenz, Englisch vollständig.
Französisch, Spanisch, Italienisch und Türkisch sind angelegt und fallen bis zur
Übersetzung sichtbar auf Deutsch zurück. Eine neue Sprache ist ein Objekt vom Typ
`Dictionary` – TypeScript erzwingt Vollständigkeit.

Engine-Texte (`engine/narrative.ts`) sind noch deutsch fest verdrahtet.

---

## Nächste Schritte

1. **Eigener Tile-Server oder bezahlter Anbieter** – der OSM-Tileserver ist für
   moderate Nutzung gedacht, nicht für Produktionslast (`NEXT_PUBLIC_TILE_URL`).
2. **Straßengenaue Linie** – OSRM liefert auf Wunsch die Geometrie mit.
3. **Eigene Overpass-Instanz oder Vorimport** – macht die App unabhängig von der
   Auslastung öffentlicher Server.
4. **Engine-Texte übersetzen** und die vier vorbereiteten Sprachen befüllen.
5. **Events** – `EventProvider` gegen eine echte Ticket-/Event-API.
6. **Buchungen** – `BookingProvider` implementieren, „Buchen“ pro Schritt.

---

## Tech

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS · Motion ·
Prisma / PostgreSQL
