/**
 * Die eigene Ortsdatenbank – gegen eine echte, leere Postgres-Datenbank.
 *
 * Prüft drei Fehler, die es gab und die ohne Datenbank nicht zu sehen sind:
 *
 *   1. Der zweite Import leerte die Tabelle. Jeder Ort existierte schon,
 *      wurde übersprungen und ging mit dem alten Lauf unter.
 *   2. Punkte außerhalb des Gebiets galten als abgedeckt, sobald irgendein
 *      Ort im Umkreis von 60 km lag – sie bekamen leere Pläne statt Overpass.
 *   3. Bei großem Umkreis kamen irgendwelche 4000 Orte, nicht die nächsten.
 *
 * NUR gegen eine Wegwerf-Datenbank. Der Test löscht und schreibt. Läuft in
 * GitHub Actions mit einem eigenen Postgres-Container
 * (.github/workflows/tests.yml) und verweigert eine Neon-Adresse:
 *
 *   TEST_DATENBANK=1 DATABASE_URL=postgresql://... \
 *   node --import ./infra/aliasHaken.mjs --experimental-strip-types \
 *     infra/tests/ortsdatenbank.mts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, utimesSync } from 'node:fs';

const AUSZUG = process.env.AUSZUG ?? '.osm/europe-germany-berlin-latest.osm.pbf';
const url = process.env.DATABASE_URL ?? '';

if (process.env.TEST_DATENBANK !== '1' || !url) {
  console.error('Nur mit TEST_DATENBANK=1 und einer Wegwerf-DATABASE_URL. Der Test löscht Daten.');
  process.exit(1);
}
if (/neon\.tech/i.test(url)) {
  // Schutz gegen den teuersten Tippfehler: die Produktionsdatenbank.
  console.error('Das ist eine Neon-Adresse. Dieser Test läuft nur gegen eine Wegwerf-Datenbank.');
  process.exit(1);
}
if (!existsSync(AUSZUG)) {
  console.error(`Auszug fehlt: ${AUSZUG}`);
  process.exit(1);
}

const { PrismaClient } = await import('@prisma/client');
const { PostgresPlaceProvider } = await import('../../db/postgresPlaceProvider.ts');

const prisma = new PrismaClient();
let ok = 0;
let fail = 0;
const schlecht: string[] = [];
function chk(name: string, bedingung: boolean, info = ''): void {
  if (bedingung) ok += 1;
  else {
    fail += 1;
    schlecht.push(name);
  }
  console.log(`   ${bedingung ? 'PASS' : 'FAIL'}  ${name}${info ? ' – ' + info : ''}`);
}

function importieren(): void {
  execFileSync(
    process.execPath,
    [
      '--no-warnings', '--import', './infra/aliasHaken.mjs', '--experimental-strip-types',
      'infra/osm-import/importieren.mts', AUSZUG, 'europe/germany/berlin',
    ],
    { stdio: 'inherit' },
  );
}

try {
  await prisma.osmImport.deleteMany({});

  console.log('### 1 · Ein zweiter Import lässt den Bestand stehen');
  importieren();
  const nachErstem = await prisma.osmPlace.count();
  chk('Erster Import schreibt Orte', nachErstem > 10_000, `${nachErstem}`);

  // Derselbe Auszug würde als „schon importiert" übersprungen – die
  // Kennung enthält den Stand. Also den Stand um einen Tag verschieben,
  // als käme der Auszug des nächsten Monats.
  const alt = statSync(AUSZUG).mtime;
  const morgen = new Date(alt.getTime() + 86_400_000);
  utimesSync(AUSZUG, morgen, morgen);
  try {
    importieren();
  } finally {
    utimesSync(AUSZUG, alt, alt);
  }
  const nachZweitem = await prisma.osmPlace.count();
  chk('Zweiter Import: gleich viele Orte', nachZweitem === nachErstem, `${nachErstem} -> ${nachZweitem}`);
  const laeufe = await prisma.osmImport.count();
  chk('Genau ein Lauf je Gebiet', laeufe === 1, `${laeufe} Läufe`);

  const provider = new PostgresPlaceProvider();

  console.log('\n### 2 · Abgedeckt heißt: drinnen, nicht daneben');
  const alex = { lat: 52.5219, lon: 13.4132 };
  const drinnen = await provider.search({ center: alex, radiusMeters: 2000 });
  chk('Alexanderplatz liefert Orte', drinnen.length > 50, `${drinnen.length}`);

  // 30 km westlich der Stadtgrenze, Berlin ist nur auf einer Seite.
  // Brandenburg ist hier nicht importiert – also gehört der Punkt Overpass.
  const draussen = { lat: 52.53, lon: 12.75 };
  let fehler = '';
  try {
    await provider.search({ center: draussen, radiusMeters: 2000 });
  } catch (e) {
    fehler = e instanceof Error ? e.name : String(e);
  }
  chk('Punkt außerhalb wird an Overpass abgegeben', fehler === 'GebietNichtAbgedecktError', fehler || 'leere Liste statt Abgabe');

  console.log('\n### 3 · Bei großem Umkreis kommen die nächsten Orte');
  const weit = await provider.search({ center: alex, radiusMeters: 15_000 });
  const nah = await provider.search({ center: alex, radiusMeters: 600 });
  const weitIds = new Set(weit.map((p) => p.id));
  const fehlen = nah.filter((p) => !weitIds.has(p.id));
  chk('Alle Orte aus 600 m sind auch bei 15 km dabei', nah.length > 0 && fehlen.length === 0,
    `${nah.length} nahe, ${fehlen.length} fehlen bei ${weit.length} Treffern`);

  console.log('\n### 4 · Glücksspiel kommt auch hier nicht durch');
  const gesamt = await provider.search({ center: alex, radiusMeters: 15_000 });
  chk('Kein Glücksspielort in der Suche', gesamt.every((p) => p.gambling !== true), `${gesamt.length} geprüft`);
} finally {
  await prisma.$disconnect();
}

console.log(`\n==== ${ok} PASS / ${fail} FAIL ====`);
schlecht.forEach((x) => console.log('  ! ' + x));
if (fail > 0) process.exit(1);
