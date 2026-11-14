/**
 * Kurze ÖPNV-Wege werden gelaufen – lange bleiben ehrlich geschätzt.
 *
 * Ohne Netz, mit nachgebauten Routing-Quellen:
 *
 *   node --import ./infra/aliasHaken.mjs --experimental-strip-types \
 *     infra/tests/oepnv-fussweg.mts
 */
import { FallbackRoutingProvider, OEPNV_ZU_FUSS_BIS_M } from '../../providers/routing/fallbackRoutingProvider.ts';
import type { RouteQuery, RoutingProvider } from '../../providers/types.ts';
import type { TravelLeg } from '../../types/domain.ts';

let ok = 0;
let fail = 0;
function chk(name: string, bedingung: boolean, info = ''): void {
  if (bedingung) ok += 1;
  else fail += 1;
  console.log(`   ${bedingung ? 'PASS' : 'FAIL'}  ${name}${info ? ' – ' + info : ''}`);
}

/** Wie OSRM: Fuß/Rad/Auto mit Straßenführung, kein ÖPNV. */
function osrm(erreichbar = true): RoutingProvider {
  return {
    id: 'osrm-attrappe',
    async route(q: RouteQuery): Promise<TravelLeg> {
      if (!erreichbar) throw new Error('nicht erreichbar');
      if (q.mode === 'transit') throw new Error('kein Profil');
      return { mode: q.mode, distanceMeters: 700, durationMin: 9, estimated: false, geometry: '_p~iF~ps|U_ulLnnqC' };
    },
    async routeMany(qs) { return Promise.all(qs.map((q) => this.route(q))); },
  };
}
const schaetzung: RoutingProvider = {
  id: 'schaetzung',
  async route(q) { return { mode: q.mode, distanceMeters: 900, durationMin: 12, estimated: true }; },
  async routeMany(qs) { return Promise.all(qs.map((q) => this.route(q))); },
};

const start = { lat: 52.5376, lon: 13.3865 };
// Ein Breitengrad sind rund 111 km – daraus die Zielpunkte.
const nah = { lat: start.lat + 600 / 111_320, lon: start.lon };
const weit = { lat: start.lat + (OEPNV_ZU_FUSS_BIS_M + 800) / 111_320, lon: start.lon };

const r = new FallbackRoutingProvider(osrm(), schaetzung);

const kurz = await r.route({ from: start, to: nah, mode: 'transit' });
chk('600 m ÖPNV werden gelaufen', kurz.mode === 'walk', `mode=${kurz.mode}`);
chk('…mit echter Straßenführung', !kurz.estimated && Boolean(kurz.geometry));

const lang = await r.route({ from: start, to: weit, mode: 'transit' });
chk('2 km ÖPNV bleiben ÖPNV', lang.mode === 'transit', `mode=${lang.mode}`);
chk('…und ehrlich geschätzt, ohne erfundene Linie', lang.estimated && !lang.geometry);

const ausfall = new FallbackRoutingProvider(osrm(false), schaetzung);
const ohneNetz = await ausfall.route({ from: start, to: nah, mode: 'transit' });
chk('Routing-Ausfall: zurück zur Schätzung, kein Absturz', ohneNetz.estimated && ohneNetz.mode === 'transit');

const fuss = await r.route({ from: start, to: weit, mode: 'walk' });
chk('Fußwege bleiben unverändert geroutet', fuss.mode === 'walk' && !fuss.estimated);

console.log(`\n==== ${ok} PASS / ${fail} FAIL ====`);
if (fail > 0) process.exit(1);
