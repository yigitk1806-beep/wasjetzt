/**
 * Holt einen Geofabrik-Auszug und prueft ihn, bevor er benutzt wird.
 *
 *   node --experimental-strip-types infra/osm-import/holen.mts <gebiet> [zielordner]
 *
 * Beispiel:
 *   node --experimental-strip-types infra/osm-import/holen.mts europe/germany/berlin
 *
 * Zwei Dinge macht dieses Skript, die ein `curl` nicht von sich aus tut:
 *
 *   1. Pruefsumme vergleichen. Geofabrik veroeffentlicht neben jeder Datei
 *      eine `.md5`. Ein halb uebertragener Auszug sieht sonst aus wie ein
 *      vollstaendiger, und der Import wuerde stillschweigend weniger Orte
 *      schreiben als es gibt.
 *
 *   2. Den Zeitstempel des Servers uebernehmen. Sonst traegt die Datei den
 *      Zeitpunkt des Downloads, und der Import wuerde einen Auszug von
 *      vorgestern als heute frisch ausweisen. Genau diese Angabe zeigt
 *      `/api/health` dem Nutzer als Alter der Ortsdaten - sie muss stimmen.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WASJETZT_USER_AGENT } from '../../lib/kennung.ts';

const BASIS = 'https://download.geofabrik.de';

const gebiet = process.argv[2];
const ordner = process.argv[3] ?? join(process.cwd(), '.osm');

if (!gebiet) {
  console.error('Aufruf: holen.mts <gebiet> [zielordner]');
  console.error('Beispiel: holen.mts europe/germany/berlin');
  console.error('Gebiete: https://download.geofabrik.de');
  process.exit(1);
}

const url = `${BASIS}/${gebiet}-latest.osm.pbf`;
const datei = join(ordner, `${gebiet.replace(/\//g, '-')}-latest.osm.pbf`);

mkdirSync(ordner, { recursive: true });

console.log(`Quelle: ${url}`);

/* 1. Erwartete Pruefsumme zuerst - ohne sie waere der Download ungeprueft. */
const md5Antwort = await fetch(`${url}.md5`, {
  headers: { 'User-Agent': WASJETZT_USER_AGENT },
  signal: AbortSignal.timeout(30_000),
});
if (!md5Antwort.ok) {
  console.error(`Pruefsumme nicht abrufbar: HTTP ${md5Antwort.status}`);
  console.error('Gibt es dieses Gebiet? Liste unter https://download.geofabrik.de');
  process.exit(1);
}
const erwartet = (await md5Antwort.text()).trim().split(/\s+/)[0];
console.log(`Erwartete Pruefsumme: ${erwartet}`);

/* 2. Die Datei selbst. */
const t0 = Date.now();
const antwort = await fetch(url, {
  headers: { 'User-Agent': WASJETZT_USER_AGENT },
  signal: AbortSignal.timeout(600_000),
});
if (!antwort.ok) {
  console.error(`Download fehlgeschlagen: HTTP ${antwort.status}`);
  process.exit(1);
}

const stand = antwort.headers.get('last-modified');
const inhalt = Buffer.from(await antwort.arrayBuffer());
const sekunden = (Date.now() - t0) / 1000;
console.log(
  `Geladen: ${(inhalt.length / 1048576).toFixed(1)} MB in ${sekunden.toFixed(1)} s`,
);

/* 3. Pruefen, bevor geschrieben wird. Eine kaputte Datei soll nicht im
 *    Zielordner landen, wo sie beim naechsten Lauf fuer gueltig gilt. */
const tatsaechlich = createHash('md5').update(inhalt).digest('hex');
if (tatsaechlich !== erwartet) {
  console.error('\nPruefsumme stimmt NICHT.');
  console.error(`  erwartet:     ${erwartet}`);
  console.error(`  tatsaechlich: ${tatsaechlich}`);
  console.error('Nichts geschrieben. Noch einmal versuchen.');
  process.exit(1);
}
console.log('Pruefsumme stimmt.');

writeFileSync(datei, inhalt);

/* 4. Den Stand des Servers uebernehmen, nicht den der Uhr hier. */
if (stand) {
  const zeit = new Date(stand);
  if (!Number.isNaN(zeit.getTime())) {
    utimesSync(datei, zeit, zeit);
    console.log(`Stand laut Geofabrik: ${zeit.toISOString()}`);
  }
}

console.log(`\nDatei: ${datei}`);
console.log('Weiter mit:');
console.log(
  `  node --env-file=.env --experimental-strip-types infra/osm-import/importieren.mts "${datei}" ${gebiet}`,
);
