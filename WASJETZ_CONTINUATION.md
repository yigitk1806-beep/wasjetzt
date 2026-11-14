# WasJetzt – Fortsetzung

Stand: 14.11.2026 · **live auf main (`fccd5fe`)** · Ortsdaten Berlin + Brandenburg importiert · CI gruen

## Live-Zustand (gemessen 11.11.2026)

- `wasjetzt-three.vercel.app` läuft auf `e373bcb`, Datenbank verbunden.
- Overpass: alle drei Instanzen im Zeitlimit, seit 20.10.2026. Kalte Gegenden bekommen keinen Plan.
- Eigene Ortsdatenbank: gebaut, **noch kein Gebiet importiert**.

## Blockiert – liegt beim Eigentümer

1. ~~Geheimnis `DATABASE_URL`~~ erledigt 14.11.
2. ~~Import~~ erledigt 14.11., live geprueft (echter Plan ohne Overpass).
3. Lokale `.env`: Passwort überholt, Neon lehnt ab. Nur nötig für lokale DB-Arbeit.
4. Impressum und rechtlich geprüfte Datenschutzerklärung fehlen – Pflicht vor öffentlichem Launch in Deutschland. Nicht erfunden, braucht Name/Anschrift und Prüfung.

## In diesem Abschnitt erledigt (11.11.2026)

| Commit | Inhalt |
| --- | --- |
| `3b380f8` | Ungeschützten `DELETE /api/plan/[id]` entfernt – jeder Linkempfänger konnte Gruppenpläne löschen |
| `01d0343` | Ratenbremse für alle teuren Endpunkte, Test 13/13 |
| `f5c0148` | Sicherheits-Header (ohne CSP) |

Davor (05.11.): eigene Ortsdatenbank, Import-Workflow, User-Agent-Korrektur, Tests.

## Tests (zuletzt ausgeführt 11.11.2026)

- `infra/tests/ratenbremse.mts` – 13 PASS / 0 FAIL
- `infra/tests/ortsdaten.mts` – 25 PASS / 0 FAIL / 1 nicht messbar
- `infra/tests/gluecksspiel.mjs` – 30 PASS / 0 FAIL (05.11., vor der Ratenbremse; lokal ist sie aus)
- Typecheck, Build: grün

## Offen, nach Priorität

- **P0** Import ausführen (oben 1–2). Ohne ihn ist die App in den meisten Gegenden nutzlos.
- **P0** Impressum/Datenschutz (oben 4).
- **P1** CSP mit Nonces; geteilte Ratenbremse (DB oder Vercel-Firewall) statt je Instanz.
- **P1** Kein ESLint eingerichtet (`next lint` ohne Konfiguration).
- **P2** Zeichenreihenfolge der Kartenlinien automatisiert testen (bräuchte Playwright).
- **P2** Preise: keine Quelle, bleiben „geschätzt“.

Bewusst nicht gemacht: die übrigen sieben `WASJETZ_*`-Dokumente und neue Features – auf Wunsch sparsam gearbeitet. Bestehende Funktionen (Überrasch mich, Date-/Familien-/Gruppenmodus, Ersetzen, Verschieben, Touren) sind schon vorhanden.

## Nächster Schritt

Nach dem Import: `curl https://<vorschau>/api/health` → `ortsquelle` muss `eigene-datenbank+overpass` zeigen und `ortsdaten` die Gebiete mit Orten.
