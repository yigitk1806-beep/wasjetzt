/**
 * Echte Bus- und Bahnverbindungen – ohne Netz, mit einer gespeicherten
 * Antwort von transport.rest (Ackerstraße → Alexanderplatz, 16.11.2026
 * 14:00, abgerufen am 14.11.2026).
 *
 *   node --import ./infra/aliasHaken.mjs --experimental-strip-types \
 *     infra/tests/oepnv-verbindung.mts
 */
import { readFileSync } from 'node:fs';
import { OepnvRoutingProvider, alsWeg, encodePolyline, type Reise } from '../../providers/routing/oepnvRoutingProvider.ts';
import { FallbackRoutingProvider } from '../../providers/routing/fallbackRoutingProvider.ts';
import { decodePolyline } from '../../lib/wege.ts';
import type { RouteQuery, RoutingProvider } from '../../providers/types.ts';
import type { TravelLeg } from '../../types/domain.ts';

let ok = 0;
let fail = 0;
function chk(name: string, bedingung: boolean, info = ''): void {
  if (bedingung) ok += 1;
  else fail += 1;
  console.log(`   ${bedingung ? 'PASS' : 'FAIL'}  ${name}${info ? ' – ' + info : ''}`);
}

const reise = JSON.parse(readFileSync('infra/tests/fixtures/transport-rest-reise.json', 'utf8')).journeys[0] as Reise;
const start = { lat: 52.5376, lon: 13.3865 };
const ziel = { lat: 52.5219, lon: 13.4132 };
const ab = new Date('2026-11-16T14:00:00+01:00');
const query: RouteQuery = { from: start, to: ziel, mode: 'transit', departISO: ab.toISOString() };

/** Fußwege wie OSRM: eine kurze, nicht gerade Linie. */
let fussAufrufe = 0;
const fuss: RoutingProvider = {
  id: 'fuss-attrappe',
  async route(q) {
    fussAufrufe += 1;
    const mitte = { lat: (q.from.lat + q.to.lat) / 2 + 0.0003, lon: (q.from.lon + q.to.lon) / 2 };
    return {
      mode: 'walk', distanceMeters: 300, durationMin: 4, estimated: false,
      geometry: encodePolyline([[q.from.lat, q.from.lon], [mitte.lat, mitte.lon], [q.to.lat, q.to.lon]]),
    };
  },
  async routeMany(qs) { return Promise.all(qs.map((q) => this.route(q))); },
};

console.log('### 1 · Die Verbindung wird richtig gelesen');
const weg = await alsWeg(reise, query, ab, fuss);
chk('Bus & Bahn, nicht geschätzt', weg.mode === 'transit' && !weg.estimated);
chk('Linien in Fahrtreihenfolge', weg.oepnv?.linien.join(' → ') === 'M10 → U8', weg.oepnv?.linien.join(' → '));
chk('Einstieg ist die erste Haltestelle', /Gedenkstätte Berliner Mauer/.test(weg.oepnv?.einstieg ?? ''), weg.oepnv?.einstieg);
chk('Abfahrt der ersten Linie steht dabei', Boolean(weg.oepnv?.abfahrtISO));

// Ankunft 14:18 laut Fixture plus Fußweg bis zum Ziel. Gezählt wird ab dem
// gewünschten Aufbruch – das Warten gehört zum Weg.
const ankunft = new Date(reise.legs!.at(-1)!.arrival ?? reise.legs!.at(-1)!.plannedArrival!);
const erwartet = Math.round((ankunft.getTime() - ab.getTime()) / 60_000);
chk('Dauer zählt ab Aufbruch bis Ankunft', weg.durationMin === erwartet, `${weg.durationMin} min`);

const punkte = weg.geometry ? decodePolyline(weg.geometry) : [];
chk('Strecke hat viele Stützpunkte, keine gerade Linie', punkte.length > 20, `${punkte.length} Punkte`);
const [a, z] = [punkte[0], punkte.at(-1)!];
chk('Strecke beginnt am Start und endet am Ziel',
  Math.abs(a[0] - start.lat) < 0.003 && Math.abs(z[0] - ziel.lat) < 0.003,
  `${a.map((x) => x.toFixed(4))} … ${z.map((x) => x.toFixed(4))}`);
chk('Länge plausibel (Luftlinie ~2,4 km)', weg.distanceMeters > 2000 && weg.distanceMeters < 6000, `${weg.distanceMeters} m`);
chk('Fußstücke werden straßengenau berechnet', fussAufrufe > 0, `${fussAufrufe} Fußwege`);

console.log('\n### 2 · Nur Fußweg heißt Fußweg');
const nurFuss: Reise = { legs: [{ walking: true, origin: { latitude: 52.53, longitude: 13.38 }, destination: { latitude: 52.535, longitude: 13.385 }, plannedArrival: '2026-11-16T14:09:00+01:00' }] };
const zuFuss = await alsWeg(nurFuss, query, ab, fuss);
chk('Ohne Linie: mode walk, keine ÖPNV-Angabe', zuFuss.mode === 'walk' && !zuFuss.oepnv);

console.log('\n### 3 · Ausfall führt zur ehrlichen Schätzung');
const schaetzung: RoutingProvider = {
  id: 'schaetzung',
  async route(q): Promise<TravelLeg> { return { mode: q.mode, distanceMeters: 2500, durationMin: 20, estimated: true }; },
  async routeMany(qs) { return Promise.all(qs.map((q) => this.route(q))); },
};
const osrmOhneOepnv: RoutingProvider = {
  id: 'osrm', async route(q) { if (q.mode === 'transit') throw new Error('kein Profil'); return fuss.route(q); },
  async routeMany(qs) { return Promise.all(qs.map((q) => this.route(q))); },
};
const kaputt = new OepnvRoutingProvider(fuss, (async () => new Response('Too Many Requests', { status: 429 })) as typeof fetch);
const kette = new FallbackRoutingProvider(osrmOhneOepnv, schaetzung, kaputt);
const warn = console.warn;
console.warn = () => undefined;
const notfall = await kette.route(query);
console.warn = warn;
chk('429 von transport.rest: geschätzt, kein Absturz', notfall.estimated && !notfall.geometry && !notfall.oepnv);

console.log('\n### 4 · Gleiche Wege fragen den Dienst nur einmal');
let abrufe = 0;
const zaehlend = new OepnvRoutingProvider(fuss, (async () => {
  abrufe += 1;
  return new Response(JSON.stringify({ journeys: [reise] }), { status: 200 });
}) as typeof fetch);
await zaehlend.route(query);
await zaehlend.route({ ...query, departISO: new Date(ab.getTime() + 60_000).toISOString() });
chk('Zweiter Aufruf aus dem Zwischenspeicher', abrufe === 1, `${abrufe} Abruf(e)`);

console.log('\n### 5 · Fußwege werden nicht umgeleitet');
let fehler = '';
try { await zaehlend.route({ ...query, mode: 'walk' }); } catch (e) { fehler = String(e); }
chk('transport.rest lehnt Nicht-ÖPNV ab', fehler.length > 0);

console.log(`\n==== ${ok} PASS / ${fail} FAIL ====`);
if (fail > 0) process.exit(1);
