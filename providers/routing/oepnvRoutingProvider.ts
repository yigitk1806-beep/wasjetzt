import { WASJETZT_USER_AGENT } from '@/lib/kennung';
import { haversineMeters } from '@/lib/geo';
import { decodePolyline } from '@/lib/wege';
import type { RouteQuery, RoutingProvider } from '@/providers/types';
import type { Coordinates, TravelLeg } from '@/types/domain';

/**
 * Echte Bus- und Bahnverbindungen über transport.rest (VBB-Gebiet:
 * Berlin und Brandenburg).
 *
 * Vorher war jeder längere ÖPNV-Weg eine geschätzte, gestrichelte Luftlinie:
 * OSRM hat kein ÖPNV-Profil. Jetzt kommen Linie, Einstieg, Abfahrtszeit und
 * die Strecke, die die Bahn tatsächlich fährt.
 *
 * Bedingungen laut Dokumentation (geprüft 14.11.2026): keine Anmeldung,
 * 100 Anfragen pro Minute. Der Dienst wird ehrenamtlich betrieben, ohne
 * Zusage auf Erreichbarkeit – deshalb ist er nie der einzige Weg: Antwortet
 * er nicht, greift die bisherige Schätzung (`FallbackRoutingProvider`).
 * Ergebnisse werden zehn Minuten gehalten, damit Planvarianten mit gleichen
 * Wegen den Dienst nicht mehrfach fragen.
 */
const BASIS = (process.env.WASJETZT_OEPNV_URL ?? 'https://v6.bvg.transport.rest').replace(/\/+$/, '');
const TIMEOUT_MS = 5000;
const HALTEN_MS = 10 * 60_000;
/** Fußstücke darunter werden gerade gezeichnet – auf der Karte kaum sichtbar. */
const FUSS_AB_M = 80;

type Ort = {
  name?: string;
  latitude?: number;
  longitude?: number;
  location?: { latitude?: number; longitude?: number };
};

export type Abschnitt = {
  walking?: boolean;
  cancelled?: boolean;
  line?: { name?: string };
  origin?: Ort;
  destination?: Ort;
  departure?: string | null;
  plannedDeparture?: string | null;
  arrival?: string | null;
  plannedArrival?: string | null;
  polyline?: { features?: Array<{ geometry?: { coordinates?: [number, number] } }> };
};

export type Reise = { legs?: Abschnitt[] };

export class OepnvRoutingProvider implements RoutingProvider {
  readonly id = 'transport-rest';
  // Ausgeschriebene Felder statt `private readonly` im Konstruktor, damit
  // Node die Datei ohne Übersetzungsschritt laden kann (Tests in infra/).
  private readonly fuss: RoutingProvider;
  private readonly abruf: typeof fetch;
  private readonly gehalten = new Map<string, { at: number; weg: TravelLeg }>();

  constructor(fuss: RoutingProvider, abruf: typeof fetch = fetch) {
    this.fuss = fuss;
    this.abruf = abruf;
  }

  async route(query: RouteQuery): Promise<TravelLeg> {
    if (query.mode !== 'transit') throw new Error('transport.rest ist nur für Bus & Bahn zuständig');

    const ab = query.departISO ? new Date(query.departISO) : new Date();
    // Fünf-Minuten-Raster: Varianten mit fast gleicher Abfahrt teilen sich
    // eine Anfrage.
    const raster = Math.floor(ab.getTime() / 300_000);
    const schluessel = [query.from.lat, query.from.lon, query.to.lat, query.to.lon]
      .map((x) => x.toFixed(4))
      .concat(String(raster))
      .join(':');
    const alt = this.gehalten.get(schluessel);
    if (alt && Date.now() - alt.at < HALTEN_MS) return alt.weg;

    const url = new URL(`${BASIS}/journeys`);
    url.searchParams.set('from.latitude', String(query.from.lat));
    url.searchParams.set('from.longitude', String(query.from.lon));
    url.searchParams.set('from.address', 'Start');
    url.searchParams.set('to.latitude', String(query.to.lat));
    url.searchParams.set('to.longitude', String(query.to.lon));
    url.searchParams.set('to.address', 'Ziel');
    url.searchParams.set('departure', ab.toISOString());
    url.searchParams.set('results', '1');
    url.searchParams.set('polylines', 'true');
    url.searchParams.set('stopovers', 'false');
    url.searchParams.set('remarks', 'false');
    url.searchParams.set('language', 'de');

    const antwort = await this.abruf(url, {
      headers: { 'User-Agent': WASJETZT_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!antwort.ok) throw new Error(`transport.rest → ${antwort.status}`);
    const daten = (await antwort.json()) as { journeys?: Reise[] };
    const reise = daten.journeys?.[0];
    if (!reise) throw new Error('transport.rest: keine Verbindung');

    const weg = await alsWeg(reise, query, ab, this.fuss);
    this.gehalten.set(schluessel, { at: Date.now(), weg });
    if (this.gehalten.size > 500) this.gehalten.clear();
    return weg;
  }

  async routeMany(queries: RouteQuery[]): Promise<TravelLeg[]> {
    return Promise.all(queries.map((q) => this.route(q)));
  }
}

/**
 * Eine Verbindung von transport.rest als `TravelLeg`.
 *
 * Die Dauer zählt ab dem gewünschten Aufbruch, nicht ab der Abfahrt der
 * Bahn – das Warten an der Haltestelle gehört zum Weg.
 */
export async function alsWeg(
  reise: Reise,
  query: RouteQuery,
  ab: Date,
  fuss: RoutingProvider,
): Promise<TravelLeg> {
  const abschnitte = (reise.legs ?? []).filter((a) => !a.cancelled);
  if (abschnitte.length === 0) throw new Error('transport.rest: Verbindung ohne Abschnitte');

  const ankunftText = abschnitte[abschnitte.length - 1].arrival ?? abschnitte[abschnitte.length - 1].plannedArrival;
  if (!ankunftText) throw new Error('transport.rest: Ankunft fehlt');
  const ankunft = new Date(ankunftText);

  const punkte: Array<[number, number]> = [];
  for (const [i, a] of abschnitte.entries()) {
    const von = koordinate(a.origin) ?? (i === 0 ? query.from : null);
    const nach = koordinate(a.destination) ?? (i === abschnitte.length - 1 ? query.to : null);

    if (a.walking) {
      if (!von || !nach) continue;
      punkte.push(...(await fussweg(von, nach, fuss)));
      continue;
    }
    // Die Strecke, die das Fahrzeug fährt – GeoJSON, also [lon, lat].
    const strecke = (a.polyline?.features ?? [])
      .map((f) => f.geometry?.coordinates)
      .filter((c): c is [number, number] => Array.isArray(c) && c.length === 2)
      .map(([lon, lat]) => [lat, lon] as [number, number]);
    if (strecke.length >= 2) punkte.push(...strecke);
    else if (von && nach) punkte.push([von.lat, von.lon], [nach.lat, nach.lon]);
  }

  const fahrten = abschnitte.filter((a) => !a.walking && a.line?.name);
  const linien = [...new Set(fahrten.map((a) => a.line!.name!))];
  const erste = fahrten[0];

  return {
    // Nur Fußwege? Dann ist es ein Fußweg und heißt auch so.
    mode: linien.length > 0 ? 'transit' : 'walk',
    distanceMeters: Math.round(laenge(punkte)),
    durationMin: Math.max(1, Math.round((ankunft.getTime() - ab.getTime()) / 60_000)),
    estimated: false,
    geometry: punkte.length >= 2 ? encodePolyline(punkte) : undefined,
    oepnv: erste
      ? {
          linien,
          // "Gedenkstätte Berliner Mauer (Berlin)" – der Ortszusatz ist in
          // Berlin überflüssig und macht die Zeile nur lang.
          einstieg: erste.origin?.name?.replace(/\s*\([^)]*\)\s*$/, ''),
          abfahrtISO: erste.departure ?? erste.plannedDeparture ?? undefined,
        }
      : undefined,
  };
}

function koordinate(ort: Ort | undefined): Coordinates | null {
  const lat = ort?.location?.latitude ?? ort?.latitude;
  const lon = ort?.location?.longitude ?? ort?.longitude;
  return typeof lat === 'number' && typeof lon === 'number' ? { lat, lon } : null;
}

/**
 * Der Weg zur Haltestelle und von ihr weg, straßengenau. transport.rest
 * liefert dafür keine Strecke. Gelingt das Routing nicht, steht dort eine
 * gerade Linie – shortcut: bei Fußstücken von wenigen hundert Metern
 * innerhalb einer echten Verbindung vertretbar, die Zeiten bleiben echt.
 */
async function fussweg(
  von: Coordinates,
  nach: Coordinates,
  fuss: RoutingProvider,
): Promise<Array<[number, number]>> {
  const gerade: Array<[number, number]> = [
    [von.lat, von.lon],
    [nach.lat, nach.lon],
  ];
  if (haversineMeters(von, nach) < FUSS_AB_M) return gerade;
  try {
    const weg = await fuss.route({ from: von, to: nach, mode: 'walk' });
    return weg.geometry ? decodePolyline(weg.geometry) : gerade;
  } catch {
    return gerade;
  }
}

function laenge(punkte: Array<[number, number]>): number {
  let summe = 0;
  for (let i = 1; i < punkte.length; i += 1) {
    summe += haversineMeters(
      { lat: punkte[i - 1][0], lon: punkte[i - 1][1] },
      { lat: punkte[i][0], lon: punkte[i][1] },
    );
  }
  return summe;
}

/** Google-Polyline mit fünf Nachkommastellen – dasselbe Format wie OSRM. */
export function encodePolyline(punkte: Array<[number, number]>): string {
  let text = '';
  let vorLat = 0;
  let vorLon = 0;
  const wert = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      text += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    text += String.fromCharCode(n + 63);
  };
  for (const [lat, lon] of punkte) {
    const la = Math.round(lat * 1e5);
    const lo = Math.round(lon * 1e5);
    wert(la - vorLat);
    wert(lo - vorLon);
    vorLat = la;
    vorLon = lo;
  }
  return text;
}
