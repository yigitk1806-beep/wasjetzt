import type { RouteQuery, RoutingProvider } from '@/providers/types';
import type { Mobility, TravelLeg } from '@/types/domain';

/**
 * Echtes Routing über die offenen OSRM-Instanzen der FOSSGIS e.V.
 * Kein API-Schlüssel nötig, eigene Profile für Fuß, Rad und Auto.
 *
 * Bewusste Lücke: Für den ÖPNV gibt es hier kein Profil. Eine Autoroute als
 * Bahnfahrt auszugeben wäre falsch, deshalb meldet dieser Provider für
 * `transit` schlicht, dass er nicht zuständig ist – dann greift die
 * geometrische Schätzung, sichtbar als „ca.".
 */
const PROFILE: Partial<Record<Mobility, string>> = {
  walk: 'routed-foot',
  bike: 'routed-bike',
  car: 'routed-car',
};

const BASE = 'https://routing.openstreetmap.de';
const TIMEOUT_MS = 3500;

type OsrmResponse = {
  code: string;
  routes?: Array<{ distance: number; duration: number; geometry?: string }>;
};

export class OsrmUnsupportedError extends Error {
  constructor(mode: Mobility) {
    super(`OSRM hat kein Profil für "${mode}"`);
    this.name = 'OsrmUnsupportedError';
  }
}

export class OsrmRoutingProvider implements RoutingProvider {
  readonly id = 'osrm-fossgis';

  /** Kurzlebiger Cache: identische Wege tauchen beim Ersetzen erneut auf. */
  private cache = new Map<string, { at: number; leg: TravelLeg }>();
  private inflight = new Map<string, Promise<TravelLeg>>();
  private readonly ttlMs = 30 * 60 * 1000;

  async route(query: RouteQuery): Promise<TravelLeg> {
    const profile = PROFILE[query.mode];
    if (!profile) throw new OsrmUnsupportedError(query.mode);

    const key = cacheKey(query);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.leg;

    // Die Planvarianten teilen sich oft denselben Weg (etwa vom Standort zum
    // ersten Restaurant). Ohne diese Zusammenfassung würde derselbe Weg
    // mehrfach gleichzeitig abgefragt.
    const running = this.inflight.get(key);
    if (running) return running;

    const request = this.fetchRoute(query, profile, key).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, request);
    void request.catch(() => undefined);
    return request;
  }

  private async fetchRoute(
    query: RouteQuery,
    profile: string,
    key: string,
  ): Promise<TravelLeg> {
    const coords = `${query.from.lon.toFixed(5)},${query.from.lat.toFixed(5)};${query.to.lon.toFixed(5)},${query.to.lat.toFixed(5)}`;
    // Mit Geometrie: Die Karte zeigt genau den Weg, aus dem Distanz und Dauer
    // stammen – nicht eine Luftlinie daneben.
    const url = `${BASE}/${profile}/route/v1/driving/${coords}?overview=full&geometries=polyline&alternatives=false&steps=false`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'WasJetzt/0.1 (Freizeitplaner)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);

    const json = (await res.json()) as OsrmResponse;
    const route = json.routes?.[0];
    if (json.code !== 'Ok' || !route) throw new Error(`OSRM: ${json.code}`);

    const leg: TravelLeg = {
      mode: query.mode,
      distanceMeters: Math.round(route.distance),
      // Unter 40 Metern ist man schon da – kein "1 Min." für null Meter.
      durationMin: route.distance < 40 ? 0 : Math.max(1, Math.round(route.duration / 60)),
      estimated: false,
      geometry: route.geometry || undefined,
    };

    this.cache.set(key, { at: Date.now(), leg });
    return leg;
  }

  async routeMany(queries: RouteQuery[]): Promise<TravelLeg[]> {
    return Promise.all(queries.map((q) => this.route(q)));
  }
}

function cacheKey(query: RouteQuery): string {
  return [
    query.mode,
    query.from.lat.toFixed(4),
    query.from.lon.toFixed(4),
    query.to.lat.toFixed(4),
    query.to.lon.toFixed(4),
  ].join('|');
}
