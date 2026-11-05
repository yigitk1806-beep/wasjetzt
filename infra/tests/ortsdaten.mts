/**
 * Die eigene Ortsdatenbank enthaelt echte Orte - und zwar die richtigen.
 *
 * Der Anlass: Die oeffentlichen Overpass-Server tragen die Last nicht. Am
 * 04.11.2026 waren alle drei seit 15 Tagen ununterbrochen im Zeitlimit.
 * Seitdem liest WasJetzt importierte Gebiete aus der eigenen Datenbank. Das
 * verschiebt ein Risiko: Nicht mehr "ist der Server erreichbar", sondern
 * "steht im Auszug wirklich drin, was wir behaupten".
 *
 * Geprueft wird deshalb an nachpruefbaren Tatsachen, nicht an Zahlen, die
 * dieses Skript sich selbst ausgerechnet hat. Ein Test, der nur bestaetigt,
 * dass der Leser dasselbe liest wie beim letzten Lauf, sagt nichts darueber,
 * ob er richtig liest.
 *
 * VORAUSSETZUNG: der Berlin-Auszug. Holen mit
 *
 *   node --experimental-strip-types infra/osm-import/holen.mts europe/germany/berlin
 *
 * Dann:
 *
 *   node --experimental-strip-types infra/tests/ortsdaten.mts
 *
 * Ohne Datei meldet sich der Test als nicht messbar und bricht mit
 * Exit-Code 1 ab - er gilt dann nicht als bestanden.
 */
import { existsSync } from 'node:fs';
import { leseKnoten, leseWege, leseKoordinaten } from '../osm-import/pbfLeser.mts';
import { classify, istGluecksspiel } from '../../providers/osm/taxonomy.ts';
import { classifySight } from '../../providers/osm/sights.ts';
import { toPlace, toSight } from '../../providers/osm/osmToPlace.ts';
import { alsElement, ausPlaceId, umkreisKasten } from '../../db/postgresPlaceProvider.ts';

const PFAD = process.env.AUSZUG ?? '.osm/europe-germany-berlin-latest.osm.pbf';

let ok = 0;
let fail = 0;
let infra = 0;
const schlecht: string[] = [];

function chk(name: string, bedingung: boolean | null, info = ''): void {
  if (bedingung === null) {
    infra += 1;
    console.log(`   INFRA ${name} – nicht messbar${info ? ' – ' + info : ''}`);
    return;
  }
  if (bedingung) {
    ok += 1;
    console.log(`   PASS  ${name}${info ? ' – ' + info : ''}`);
  } else {
    fail += 1;
    schlecht.push(`${name}${info ? ' – ' + info : ''}`);
    console.log(`   FAIL  ${name}${info ? ' – ' + info : ''}`);
  }
}

if (!existsSync(PFAD)) {
  console.error(`\nAuszug nicht gefunden: ${PFAD}`);
  console.error('Holen mit:');
  console.error('  node --experimental-strip-types infra/osm-import/holen.mts europe/germany/berlin');
  console.error('Oder AUSZUG=<pfad> setzen.');
  process.exit(1);
}

type Satz = { id: string; lat: number; lon: number; tags: Record<string, string> };

console.log(`Auszug: ${PFAD}\n`);
console.log('### 1 · Der Leser liest den Auszug vollstaendig');

const knotenOrte: Satz[] = [];
const kl = leseKnoten(PFAD, (ort) => {
  if (!ort.tags.name) return;
  if (!classify(ort.tags) && !classifySight(ort.tags)) return;
  knotenOrte.push({ id: ort.id, lat: ort.lat, lon: ort.lon, tags: ort.tags });
});

// Berlin hat Millionen Knoten. Eine Groessenordnung daneben heisst: Der
// Leser bricht irgendwo ab, ohne zu klagen - genau der Fehler, der sich
// sonst erst in fehlenden Orten zeigt.
chk('Knotenzahl in plausibler Groessenordnung', kl.knoten > 5_000_000 && kl.knoten < 20_000_000,
  `${kl.knoten.toLocaleString('de-DE')} Knoten`);
chk('Knoten mit Tags gefunden', kl.mitTags > 500_000, `${kl.mitTags.toLocaleString('de-DE')}`);
chk('Brauchbare Orte aus Knoten', knotenOrte.length > 10_000, `${knotenOrte.length.toLocaleString('de-DE')}`);

const kandidaten: Array<{ id: number; tags: Record<string, string>; knoten: number[] }> = [];
const gesucht = new Set<number>();
const wl = leseWege(PFAD, (weg) => {
  if (!weg.tags.name) return;
  if (!classify(weg.tags) && !classifySight(weg.tags)) return;
  if (weg.knoten.length === 0) return;
  kandidaten.push(weg);
  for (const n of weg.knoten) gesucht.add(n);
});
chk('Wegzahl in plausibler Groessenordnung', wl.wege > 500_000 && wl.wege < 5_000_000,
  `${wl.wege.toLocaleString('de-DE')} Wege`);

const koordinaten = leseKoordinaten(PFAD, gesucht);
// Das ist der harte Beleg fuer die Protobuf-Dekodierung: Jeder Knoten, auf
// den ein Weg zeigt, muss im selben Auszug auch als Knoten vorkommen.
// Fehlt einer, ist der Lesezeiger irgendwo verrutscht. Genau dieser Fehler
// steckte zuerst in `ueberspringen` - `z.pos += varint(z)` las die linke
// Seite vor dem Funktionsaufruf und sprang drei Bytes zu kurz.
chk('Jeder von einem Weg genannte Knoten wurde gefunden',
  koordinaten.size === gesucht.size,
  `${koordinaten.size.toLocaleString('de-DE')} von ${gesucht.size.toLocaleString('de-DE')}`);

console.log('\n### 2 · Alle Koordinaten liegen in Berlin');

// Grosszuegiger Kasten um Berlin. Ein Ort ausserhalb bedeutet eine falsch
// dekodierte Koordinate - der haeufigste stille Fehler beim PBF-Lesen, weil
// Differenz und Versatz leicht zu verwechseln sind.
const KASTEN = { latMin: 52.2, latMax: 52.8, lonMin: 12.9, lonMax: 13.9 };
const drin = (lat: number, lon: number) =>
  lat >= KASTEN.latMin && lat <= KASTEN.latMax && lon >= KASTEN.lonMin && lon <= KASTEN.lonMax;

const ausreisser = knotenOrte.filter((o) => !drin(o.lat, o.lon));
chk('Knotenorte liegen im Berliner Kasten', ausreisser.length === 0,
  ausreisser.length ? `${ausreisser.length} daneben, z. B. ${ausreisser[0].tags.name} bei ${ausreisser[0].lat.toFixed(3)},${ausreisser[0].lon.toFixed(3)}` : `${knotenOrte.length} geprueft`);

const wegOrte: Satz[] = [];
let ohneKoordinate = 0;
for (const weg of kandidaten) {
  let sLat = 0;
  let sLon = 0;
  let zahl = 0;
  for (const n of weg.knoten) {
    const p = koordinaten.get(n);
    if (!p) continue;
    sLat += p[0];
    sLon += p[1];
    zahl += 1;
  }
  if (zahl === 0) {
    ohneKoordinate += 1;
    continue;
  }
  wegOrte.push({ id: `way/${weg.id}`, lat: sLat / zahl, lon: sLon / zahl, tags: weg.tags });
}
const wegAusreisser = wegOrte.filter((o) => !drin(o.lat, o.lon));
chk('Weg-Mittelpunkte liegen im Berliner Kasten', wegAusreisser.length === 0,
  wegAusreisser.length ? `${wegAusreisser.length} daneben, z. B. ${wegAusreisser[0].tags.name}` : `${wegOrte.length} geprueft`);
chk('Kein Weg ohne Knoten im Auszug', ohneKoordinate === 0, `${ohneKoordinate} ohne`);

const alle = [...knotenOrte, ...wegOrte];

console.log('\n### 3 · Bekannte Berliner Orte sind dabei');

// Nachpruefbare Tatsachen, keine Zahlen aus diesem Skript. Jeder dieser
// Orte existiert, steht in OpenStreetMap und liegt in Berlin. Fehlt einer,
// ist entweder der Leser kaputt oder die Klassifizierung zu streng.
// Die Namen stehen hier so, wie OpenStreetMap sie fuehrt, und das ist
// nachgesehen, nicht geraten. Im ersten Entwurf standen "Fernsehturm" und
// "Zoologischer Garten" - beides falsch: OSM nennt sie "Berliner
// Fernsehturm" und "Zoo Berlin", und "Zoologischer Garten" tragen in Berlin
// vor allem die Bahnsteige des Bahnhofs. Der Test war rot, die Daten waren
// in Ordnung. Wer hier einen Namen ergaenzt, sieht ihn vorher im Auszug nach.
const WAHRZEICHEN: Array<{ name: RegExp; was: 'ort' | 'sicht'; wo?: [number, number] }> = [
  { name: /^Berliner Dom$/, was: 'sicht', wo: [52.5192, 13.4010] },
  { name: /^Brandenburger Tor$/, was: 'sicht', wo: [52.5163, 13.3777] },
  { name: /^Pergamonmuseum$/, was: 'sicht' },
  // Nur Sehenswuerdigkeit, kein Ausgehort: `classify` gibt null, erst
  // `classifySight` nimmt ihn an. Genau dieser Ort waere im ersten Entwurf
  // des Imports verschwunden.
  { name: /^Berliner Fernsehturm$/, was: 'sicht', wo: [52.5208, 13.4094] },
  { name: /^Zoo Berlin$/, was: 'sicht' },
  // Mit Praefix, nicht exakt: OpenStreetMap fuehrt zu diesem Wahrzeichen
  // drei Objekte - eine wandmontierte Gedenktafel, eine Skulptur
  // (`tourism=artwork`) und das Bauwerk selbst, das
  // "Kaiser-Wilhelm-Gedächtniskirche (Ruine)" heisst und die Tags traegt.
  // Nur das Bauwerk ist die Sehenswuerdigkeit; Tafel und Skulptur fallen
  // zu Recht durch. Ein exakter Namensvergleich traf die Skulptur und
  // meldete das Wahrzeichen als fehlend, obwohl es da ist.
  { name: /^Kaiser-Wilhelm-Gedächtniskirche/, was: 'sicht' },
];

for (const wz of WAHRZEICHEN) {
  const treffer = alle.filter((o) => wz.name.test(o.tags.name ?? ''));
  const passend = treffer.filter((o) =>
    wz.was === 'sicht' ? classifySight(o.tags) !== null : classify(o.tags) !== null,
  );
  let info = `${treffer.length} Treffer, ${passend.length} als ${wz.was === 'sicht' ? 'Sehenswuerdigkeit' : 'Ausgehort'}`;

  if (wz.wo && passend.length > 0) {
    // Nicht nur vorhanden, sondern an der richtigen Stelle. Ein Ort mit dem
    // richtigen Namen an falschen Koordinaten waere der schlimmere Fehler:
    // Der Nutzer liefe hin.
    const naechster = passend
      .map((o) => ({ o, m: meter(o.lat, o.lon, wz.wo![0], wz.wo![1]) }))
      .sort((a, b) => a.m - b.m)[0];
    info += `, ${Math.round(naechster.m)} m von der erwarteten Stelle`;
    chk(`${wz.name.source}: gefunden und am richtigen Ort`, passend.length > 0 && naechster.m < 500, info);
    continue;
  }
  chk(`${wz.name.source}: gefunden`, passend.length > 0, info);
}

console.log('\n### 4 · Die Gluecksspielsperre greift auch hier');

// Die Datenbank speichert `gambling` als eigene Spalte, damit die Sperre
// schon in der Abfrage greift. Diese Spalte muss genau dem entsprechen, was
// `istGluecksspiel` sagt - sonst gibt es zwei Wahrheiten.
const gluecksspiel = alle.filter((o) => istGluecksspiel(o.tags));
chk('Gluecksspielorte im Auszug vorhanden', gluecksspiel.length > 20,
  `${gluecksspiel.length} gefunden`);

// Keiner davon darf durch `toPlace` ohne die Markierung kommen.
const unmarkiert = gluecksspiel
  .map((o) => toPlace({ type: o.id.startsWith('way') ? 'way' : 'node', id: Number(o.id.split('/')[1]), lat: o.lat, lon: o.lon, tags: o.tags }))
  .filter((p) => p !== null && p.gambling !== true);
chk('Kein Gluecksspielort kommt unmarkiert durch toPlace', unmarkiert.length === 0,
  unmarkiert.length ? `${unmarkiert.length} unmarkiert, z. B. ${unmarkiert[0]?.name}` : `${gluecksspiel.length} geprueft`);

// Und umgekehrt: Eine Kneipe mit `gambling=no` sagt ausdruecklich, dass es
// bei ihr keine Automaten gibt. Sie zu sperren waere genau verkehrt.
const ehrlich = alle.filter((o) => {
  const g = o.tags.gambling?.trim().toLowerCase();
  return g === 'no' || g === 'none';
});
const falschGesperrt = ehrlich.filter((o) => istGluecksspiel(o.tags));
chk('"gambling=no" wird nicht gesperrt',
  ehrlich.length === 0 ? null : falschGesperrt.length === 0,
  ehrlich.length === 0 ? 'kein solcher Ort im Auszug' : `${ehrlich.length} Orte sagen "kein Gluecksspiel", ${falschGesperrt.length} faelschlich gesperrt`);

// Gewoehnliche Freizeitangebote muessen durchkommen.
const harmlos = alle.filter((o) =>
  o.tags.leisure === 'amusement_arcade' || o.tags.leisure === 'bowling_alley' ||
  o.tags.leisure === 'miniature_golf' || o.tags.leisure === 'trampoline_park');
const harmlosGesperrt = harmlos.filter((o) => istGluecksspiel(o.tags));
chk('Videohalle, Bowling, Minigolf, Trampolin bleiben erlaubt',
  harmlos.length === 0 ? null : harmlosGesperrt.length === 0,
  `${harmlos.length} solcher Orte, ${harmlosGesperrt.length} gesperrt`);

console.log('\n### 5 · Nichts wird erfunden');

const alsPlace = alle
  .map((o) => toPlace({ type: o.id.startsWith('way') ? 'way' : 'node', id: Number(o.id.split('/')[1]), lat: o.lat, lon: o.lon, tags: o.tags }))
  .filter((p) => p !== null);

chk('Jeder Ort hat einen Namen aus OpenStreetMap',
  alsPlace.every((p) => p!.name.length > 0), `${alsPlace.length} Orte`);
chk('Kein Ort traegt die Quelle "mock"',
  alsPlace.every((p) => p!.source === 'openstreetmap'),
  `Quellen: ${[...new Set(alsPlace.map((p) => p!.source))].join(', ')}`);

// Oeffnungszeiten nur, wenn OSM sie liefert. Ein Ort ohne `opening_hours`
// darf keine bekommen - sonst stuende der Nutzer vor der Tuer.
const erfundeneZeiten = alle.filter((o) => {
  if (o.tags.opening_hours) return false;
  const p = toPlace({ type: 'node', id: 1, lat: o.lat, lon: o.lon, tags: o.tags });
  return p?.openingHours != null && (Array.isArray(p.openingHours) ? p.openingHours.length > 0 : true);
});
chk('Keine erfundenen Oeffnungszeiten', erfundeneZeiten.length === 0,
  erfundeneZeiten.length ? `${erfundeneZeiten.length} Orte ohne Tag haetten Zeiten` : 'geprueft');

const mitZeiten = alle.filter((o) => o.tags.opening_hours).length;
console.log(`   (${mitZeiten.toLocaleString('de-DE')} von ${alle.length.toLocaleString('de-DE')} Orten haben Oeffnungszeiten in OSM)`);

console.log('\n### 6 · Sehenswuerdigkeiten gehen nicht verloren');

// Dieser Fall war ein echter Fehler im ersten Entwurf: Der Import filterte
// nur nach `classify`. `classifySight` nimmt aber `historic=*`-Tags an, die
// `classify` ablehnt - Kirchen, Bruecken, Denkmaeler. 609 Berliner
// Sehenswuerdigkeiten waeren verschwunden, der Dom darunter.
const nurSicht = alle.filter((o) => !classify(o.tags) && classifySight(o.tags));
chk('Orte, die nur Sehenswuerdigkeit sind, werden behalten', nurSicht.length > 100,
  `${nurSicht.length} Stueck, z. B. ${nurSicht.slice(0, 3).map((o) => o.tags.name).join(', ')}`);

const alsSicht = nurSicht
  .map((o) => toSight({ type: o.id.startsWith('way') ? 'way' : 'node', id: Number(o.id.split('/')[1]), lat: o.lat, lon: o.lon, tags: o.tags }))
  .filter((p) => p !== null);
chk('Sie kommen auch durch toSight', alsSicht.length > 100,
  `${alsSicht.length} von ${nurSicht.length}`);

console.log('');
console.log('### 7 · Die Kennung uebersteht den Weg in die Datenbank und zurueck');

// Gespeichert ist `node/123`, im Plan steht `osm_n123`. Beide Richtungen
// muessen zusammenpassen, sonst findet "Station ersetzen" still nichts:
// `getById` gibt null zurueck, und der Nutzer sieht keinen Fehler, sondern
// nur ein Angebot weniger. Genau die Sorte Fehler, die ohne Test durchgeht.
{
  const stichprobe = [...knotenOrte.slice(0, 300), ...wegOrte.slice(0, 300)];
  const gebrochen: string[] = [];

  for (const roh of stichprobe) {
    const element = alsElement({ id: roh.id, lat: roh.lat, lon: roh.lon, tags: roh.tags });
    const ort = toPlace(element) ?? toSight(element);
    if (!ort) continue;
    const zurueck = ausPlaceId(ort.id);
    if (zurueck !== roh.id) gebrochen.push(roh.id + ' -> ' + ort.id + ' -> ' + zurueck);
  }

  chk('Kennung laeuft verlustfrei hin und zurueck', gebrochen.length === 0,
    gebrochen.length
      ? gebrochen.length + ' gebrochen, z. B. ' + gebrochen[0]
      : stichprobe.length + ' Kennungen geprueft');

  // Und was nicht von hier kommt, wird nicht geraten.
  const fremd = ['', 'osm_x5', 'node/5', 'osm_n', 'osm_nabc', 'mock_1'];
  const geraten = fremd.filter((x) => ausPlaceId(x) !== null);
  chk('Fremde Kennungen werden abgewiesen, nicht geraten', geraten.length === 0,
    geraten.length ? 'angenommen: ' + geraten.join(', ') : fremd.length + ' Formen geprueft');
}

console.log('');
console.log('### 8 · Der Suchkasten umschliesst den Umkreis wirklich');

// Der Kasten ist die Vorauswahl fuer die Datenbank. Ist er zu klein, fehlen
// Orte am Rand - und niemand merkt es, weil ein Plan ja zustande kommt, nur
// mit weniger Auswahl.
{
  const mitte = { lat: 52.5376, lon: 13.3865 };
  const zuKlein: string[] = [];
  const bogen = Math.PI / 180;

  for (const radius of [500, 1100, 5000, 25_000]) {
    const kasten = umkreisKasten(mitte, radius);
    const latGrad = radius / 111_320;
    const lonGrad = radius / (111_320 * Math.cos(mitte.lat * bogen));
    const raender = [
      { lat: mitte.lat + latGrad, lon: mitte.lon },
      { lat: mitte.lat - latGrad, lon: mitte.lon },
      { lat: mitte.lat, lon: mitte.lon + lonGrad },
      { lat: mitte.lat, lon: mitte.lon - lonGrad },
    ];
    for (const r of raender) {
      const drinnen =
        r.lat >= kasten.latMin && r.lat <= kasten.latMax &&
        r.lon >= kasten.lonMin && r.lon <= kasten.lonMax;
      if (!drinnen) zuKlein.push(radius + ' m: ' + r.lat.toFixed(4) + ',' + r.lon.toFixed(4));
    }
  }
  chk('Kasten umschliesst den Umkreis in allen Himmelsrichtungen', zuKlein.length === 0,
    zuKlein.length ? 'zu klein bei ' + zuKlein[0] : 'vier Radien x vier Richtungen');
}

console.log(`\n==== ${ok} PASS / ${fail} FAIL${infra ? ` / ${infra} nicht messbar` : ''} ====`);
schlecht.forEach((x) => console.log('  ! ' + x));
if (fail > 0) process.exit(1);

function meter(latA: number, lonA: number, latB: number, lonB: number): number {
  const R = 6_371_000;
  const b = Math.PI / 180;
  const dLat = (latB - latA) * b;
  const dLon = (lonB - lonA) * b;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(latA * b) * Math.cos(latB * b) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
