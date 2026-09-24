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
/**
 * Erster Versuch knapp, zweiter großzügiger: Eine frisch gestartete
 * Serverless-Instanz baut acht TLS-Verbindungen gleichzeitig auf – dabei
 * reißt ein zu enges Zeitlimit, obwohl der Dienst selbst in 0,1 s antwortet.
 */
const TIMEOUTS_MS = [4000, 7000];

/**
 * Wenn der Dienst gar nicht antwortet, kostet jeder Weg elf Sekunden
 * Wartezeit – bei vier Wegen ist der Plan tot, obwohl die geometrische
 * Schätzung längst bereitstünde. Nach mehreren Fehlschlägen hintereinander
 * wird deshalb kurz gar nicht mehr gefragt; die Wege sind dann ehrlich als
 * „ca." gekennzeichnet, aber sofort da.
 */
const FEHLER_BIS_PAUSE = 3;
const PAUSE_MS = 90_000;

/**
 * Wie viele Anfragen gleichzeitig hinausgehen dürfen.
 *
 * Eine Tour hat sieben Teilstrecken. Werden die alle auf einmal abgefragt,
 * beantwortet die öffentliche Instanz die ersten beiden und lässt den Rest
 * ins Zeitlimit laufen – gemessen: Strecke 1 und 2 echt, 3 bis 7 geschätzt.
 * Nacheinander dauert dasselbe keine halbe Sekunde und liefert alles echt.
 */
const MAX_PARALLEL = 2;

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
  /** Fehlschläge in Folge und, falls die Pause läuft, ihr Ende. */
  private fehler = 0;
  private pauseBis = 0;
  /** Einfache Schleuse: höchstens MAX_PARALLEL Anfragen unterwegs. */
  private aktive = 0;
  private warteschlange: Array<() => void> = [];

  async route(query: RouteQuery): Promise<TravelLeg> {
    const profile = PROFILE[query.mode];
    if (!profile) throw new OsrmUnsupportedError(query.mode);

    const key = cacheKey(query);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.leg;

    // Läuft die Pause, sofort abgeben statt jeden Weg einzeln auszusitzen.
    if (Date.now() < this.pauseBis) throw new Error('OSRM pausiert');

    // Die Planvarianten teilen sich oft denselben Weg (etwa vom Standort zum
    // ersten Restaurant). Ohne diese Zusammenfassung würde derselbe Weg
    // mehrfach gleichzeitig abgefragt.
    const running = this.inflight.get(key);
    if (running) return running;

    const request = this.schleuse(() => this.fetchRoute(query, profile, key)).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, request);
    void request.catch(() => undefined);
    return request;
  }

  /** Lässt nur MAX_PARALLEL Anfragen gleichzeitig hinaus. */
  private async schleuse<T>(fn: () => Promise<T>): Promise<T> {
    if (this.aktive >= MAX_PARALLEL) {
      await new Promise<void>((frei) => this.warteschlange.push(frei));
    }
    this.aktive += 1;
    try {
      return await fn();
    } finally {
      this.aktive -= 1;
      this.warteschlange.shift()?.();
    }
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

    let json: OsrmResponse | null = null;
    let letzterFehler: unknown = null;
    for (const [versuch, timeout] of TIMEOUTS_MS.entries()) {
      if (versuch > 0) await new Promise((r) => setTimeout(r, 300));
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'WasJetzt/0.1 (Freizeitplaner)' },
          signal: AbortSignal.timeout(timeout),
        });
        if (!res.ok) throw new Error(`OSRM ${res.status}`);
        json = (await res.json()) as OsrmResponse;
        break;
      } catch (error) {
        letzterFehler = error;
      }
    }
    if (!json) {
      this.fehler += 1;
      if (this.fehler >= FEHLER_BIS_PAUSE) this.pauseBis = Date.now() + PAUSE_MS;
      throw letzterFehler ?? new Error('OSRM nicht erreichbar');
    }
    this.fehler = 0;
    this.pauseBis = 0;

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

  /**
   * Für die Gesundheitsseite: Antwortet der Routing-Dienst von hier aus?
   *
   * Mehrere Anfragen nacheinander, klein und groß: Auf Vercel war zu sehen,
   * dass die erste Strecke ankommt und die nächsten ins Zeitlimit laufen –
   * das lässt sich nur mit einer Messreihe auseinanderhalten.
   */
  async probe(): Promise<unknown> {
    const wege = [
      { name: 'klein-1', overview: false },
      { name: 'klein-2', overview: false },
      { name: 'gross-1', overview: true },
      { name: 'gross-2', overview: true },
    ];
    const ergebnisse: unknown[] = [];
    for (const weg of wege) {
      const start = Date.now();
      const url =
        `${BASE}/routed-foot/route/v1/driving/13.3446,52.5543;13.3400,52.5510` +
        (weg.overview ? '?overview=full&geometries=polyline' : '?overview=false');
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'WasJetzt/0.1 (Freizeitplaner)' },
          signal: AbortSignal.timeout(8000),
        });
        const text = await res.text();
        ergebnisse.push({
          weg: weg.name,
          ok: res.ok,
          ms: Date.now() - start,
          bytes: text.length,
        });
      } catch (error) {
        ergebnisse.push({
          weg: weg.name,
          ok: false,
          ms: Date.now() - start,
          fehler: error instanceof Error ? `${error.name}: ${error.message}` : 'unbekannt',
        });
      }
    }
    return ergebnisse;
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
