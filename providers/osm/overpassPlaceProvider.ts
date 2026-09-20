import { haversineMeters } from '@/lib/geo';
import { profileFor } from '@/providers/activityProfiles';
import type { PlaceProvider, PlaceQuery } from '@/providers/types';
import type { Place, PriceInfo, PriceLevel } from '@/types/domain';
import { parseOpeningHours } from './openingHours';
import { buildOverpassQuery, classify, type OsmTags } from './taxonomy';

type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: OsmTags;
};

type OverpassResponse = { elements?: OverpassElement[] };

/**
 * Öffentliche Overpass-Instanzen. Sie werden der Reihe nach probiert –
 * die Endpunkte sind gespendete Infrastruktur und zeitweise überlastet.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/**
 * Suchradius gegen Overpass. Größere Mobilitätsradien (Auto: 16 km) werden
 * hierauf begrenzt – jenseits davon wird die Abfrage in dichten Städten zu
 * langsam für „Jetzt los".
 *
 * Bekannte Grenze: In sehr dichten Innenstädten greift `ELEMENT_LIMIT`, dann
 * liefert Overpass nur einen Ausschnitt der Gegend. Vollständigkeit wird
 * nirgends behauptet; die Engine arbeitet mit dem, was da ist.
 */
const MAX_RADIUS_M = 4500;
const ELEMENT_LIMIT = 900;

/** Zellgröße des Caches (~2,2 km). Kleine Ortswechsel treffen denselben Cache. */
const CACHE_CELL_DEGREES = 0.02;
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Erster Endpunkt bekommt mehr Zeit; die Ersatzinstanzen sollen nicht bremsen. */
const PRIMARY_TIMEOUT_MS = 25_000;
const MIRROR_TIMEOUT_MS = 8000;

/**
 * So lange darf eine *interaktive* Anfrage höchstens auf Overpass warten.
 *
 * Die öffentlichen Instanzen schwanken stark (gemessen 4–21 s für dieselbe
 * Abfrage). Deshalb wartet ein Klick nie unbegrenzt: Läuft das Budget über,
 * liefert die Ersatzquelle sofort etwas Brauchbares, während die echte
 * Abfrage im Hintergrund weiterläuft und den Cache füllt. Der nächste Versuch
 * ist dann sofort echt.
 *
 * Im Normalfall greift das gar nicht – die App lädt die Gegend schon beim
 * Öffnen vor (siehe `prefetch`), der Klick trifft dann den Cache.
 */
const INTERACTIVE_BUDGET_MS = 9000;

/**
 * Echte Orte aus OpenStreetMap über die Overpass-API.
 *
 * Was von hier kommt, ist echt: Name, Position, Art des Ortes und – wenn
 * vorhanden – Öffnungszeiten und Eintrittspreise. Was OSM nicht liefert,
 * wird auch nicht behauptet:
 *  - fehlen Öffnungszeiten, ist `openingHours` null,
 *  - fehlen Preise, gibt es nur ein geschätztes Niveau (€/€€/€€€),
 *  - Bewertungen gibt es gar nicht.
 */
export class OverpassPlaceProvider implements PlaceProvider {
  readonly id = 'overpass';
  readonly isMock = false;

  private cache = new Map<string, { at: number; places: Place[] }>();
  private inflight = new Map<string, Promise<Place[]>>();

  async search(query: PlaceQuery): Promise<Place[]> {
    const radius = Math.min(query.radiusMeters, MAX_RADIUS_M);
    const places = await this.loadWithinBudget(
      query.center.lat,
      query.center.lon,
      INTERACTIVE_BUDGET_MS,
    );

    const filtered = places.filter((place) => {
      if (query.categories?.length && !query.categories.includes(place.category)) {
        return false;
      }
      return haversineMeters(query.center, place.location) <= radius;
    });

    filtered.sort(
      (a, b) =>
        haversineMeters(query.center, a.location) - haversineMeters(query.center, b.location),
    );
    return query.limit ? filtered.slice(0, query.limit) : filtered;
  }

  /**
   * Lädt die Gegend im Hintergrund vor. Wird beim Öffnen der App aufgerufen,
   * damit „Jetzt los" später auf einen warmen Cache trifft. Fehler sind hier
   * bedeutungslos – es ist nur ein Vorabversuch.
   */
  async prefetch(center: { lat: number; lon: number }): Promise<void> {
    try {
      await this.load(center.lat, center.lon);
    } catch {
      /* Vorladen darf scheitern, ohne dass jemand es merkt. */
    }
  }

  /**
   * Wartet höchstens `budgetMs` auf die echte Quelle. Läuft die Zeit ab,
   * wird abgebrochen – die laufende Abfrage füllt aber weiter den Cache.
   */
  private async loadWithinBudget(
    lat: number,
    lon: number,
    budgetMs: number,
  ): Promise<Place[]> {
    const request = this.load(lat, lon);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new OverpassUnavailableError(`Zeitbudget ${budgetMs} ms überschritten`)),
        budgetMs,
      );
    });

    try {
      return await Promise.race([request, budget]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Lädt eine ganze Zelle und hält sie im Cache. */
  private load(lat: number, lon: number): Promise<Place[]> {
    const cellLat = Math.round(lat / CACHE_CELL_DEGREES) * CACHE_CELL_DEGREES;
    const cellLon = Math.round(lon / CACHE_CELL_DEGREES) * CACHE_CELL_DEGREES;
    const key = `${cellLat.toFixed(3)}:${cellLon.toFixed(3)}`;

    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return Promise.resolve(cached.places);
    }

    // Parallele Anfragen auf dieselbe Zelle teilen sich einen Request.
    const running = this.inflight.get(key);
    if (running) return running;

    const request = this.fetchCell(cellLat, cellLon)
      .then((places) => {
        this.cache.set(key, { at: Date.now(), places });
        return places;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, request);
    // Wenn der Aufrufer wegen Zeitbudget aussteigt, darf die Ablehnung
    // nicht als unbehandelt im Prozess landen.
    void request.catch(() => undefined);
    return request;
  }

  private async fetchCell(lat: number, lon: number): Promise<Place[]> {
    const query = buildOverpassQuery(lat, lon, MAX_RADIUS_M, ELEMENT_LIMIT);
    let lastError: unknown = null;

    for (const [index, endpoint] of ENDPOINTS.entries()) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // Overpass bittet um eine identifizierbare Anwendung.
            'User-Agent': 'WasJetzt/0.1 (Freizeitplaner; +https://wasjetzt.app)',
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(
            index === 0 ? PRIMARY_TIMEOUT_MS : MIRROR_TIMEOUT_MS,
          ),
        });

        if (!res.ok) throw new Error(`${endpoint} → ${res.status}`);

        const json = (await res.json()) as OverpassResponse;
        const places = (json.elements ?? [])
          .map((element) => toPlace(element))
          .filter((place): place is Place => place !== null);

        return dedupe(places);
      } catch (error) {
        lastError = error;
      }
    }

    // Kein Endpunkt erreichbar. Wir werfen bewusst, statt ein leeres Ergebnis
    // zu liefern: "API kaputt" und "hier gibt es nichts" sind verschiedene
    // Aussagen, und nur im ersten Fall darf auf eine Ersatzquelle
    // ausgewichen werden.
    throw new OverpassUnavailableError(String(lastError));
  }
}

export class OverpassUnavailableError extends Error {
  constructor(detail: string) {
    super(`Overpass nicht erreichbar: ${detail}`);
    this.name = 'OverpassUnavailableError';
  }
}

function toPlace(element: OverpassElement): Place | null {
  const tags = element.tags;
  if (!tags?.name) return null;

  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (lat === undefined || lon === undefined) return null;

  const profileKey = classify(tags);
  if (!profileKey) return null;
  const profile = profileFor(profileKey);

  // Dauerhaft geschlossene oder geplante Objekte überspringen.
  if (tags['disused:amenity'] || tags.abandoned || tags.construction) return null;
  if (tags.access === 'private' || tags.access === 'no') return null;

  return {
    id: `osm_${element.type[0]}${element.id}`,
    name: tags.name,
    category: profile.category,
    kind: profile.kind,
    emoji: profile.emoji,
    location: { lat, lon, address: addressOf(tags) },
    price: priceOf(tags, profile.priceLevel),
    typicalDurationMin: profile.typicalDurationMin,
    openingHours: parseOpeningHours(tags.opening_hours),
    indoorOutdoor: profile.indoorOutdoor,
    rainSuitability: profile.rainSuitability,
    heatSuitability: profile.heatSuitability,
    coldSuitability: profile.coldSuitability,
    bestSeasons: profile.bestSeasons,
    scores: { ...profile.scores },
    // OSM kennt keine Bewertungen – also gibt es hier auch keine.
    source: 'openstreetmap',
    minAge: minAgeOf(tags, profile.minAge),
    bookable: profile.bookable,
  };
}

/** Preis: echter Betrag nur, wenn OSM ihn wirklich angibt. */
function priceOf(tags: OsmTags, fallbackLevel: PriceLevel): PriceInfo {
  if (tags.fee === 'no' || tags['fee:conditional']?.startsWith('no')) {
    return { level: 0, levelEstimated: false };
  }

  const charge = parseCharge(tags.charge ?? tags['fee:amount']);
  if (charge !== null) {
    return {
      level: levelFromAmount(charge),
      levelEstimated: false,
      perPerson: { min: charge, max: charge },
    };
  }

  return { level: fallbackLevel, levelEstimated: true };
}

/** Versteht nur eindeutige Angaben wie "5 EUR" oder "7.50 EUR". */
function parseCharge(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,4})(?:[.,](\d{1,2}))?\s*(eur|€)$/i);
  if (!match) return null;
  const amount = Number(`${match[1]}.${match[2] ?? '0'}`);
  return Number.isFinite(amount) ? amount : null;
}

function levelFromAmount(amount: number): PriceLevel {
  if (amount === 0) return 0;
  if (amount <= 12) return 1;
  if (amount <= 30) return 2;
  return 3;
}

function minAgeOf(tags: OsmTags, fallback: number | undefined): number | undefined {
  const raw = tags['min_age'] ?? tags['age:min'];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function addressOf(tags: OsmTags): string | undefined {
  const street = tags['addr:street'];
  if (!street) return undefined;
  const number = tags['addr:housenumber'];
  return number ? `${street} ${number}` : street;
}

/**
 * OSM enthält denselben Betrieb gelegentlich mehrfach (Node + Gebäudefläche).
 * Gleicher Name in derselben ~100-m-Kachel wird zusammengefasst; der Eintrag
 * mit den meisten Angaben gewinnt.
 */
function dedupe(places: Place[]): Place[] {
  const byKey = new Map<string, Place>();

  for (const place of places) {
    const key = [
      place.name.toLowerCase(),
      place.location.lat.toFixed(3),
      place.location.lon.toFixed(3),
    ].join('|');

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, place);
      continue;
    }
    if (!existing.openingHours && place.openingHours) byKey.set(key, place);
  }

  return [...byKey.values()];
}
