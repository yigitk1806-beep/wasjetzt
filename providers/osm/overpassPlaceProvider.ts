import { haversineMeters } from '@/lib/geo';
import { profileFor } from '@/providers/activityProfiles';
import { InMemoryPlaceCache, type PlaceCacheStore } from '@/providers/placeCache';
import type { PlaceProvider, PlaceQuery } from '@/providers/types';
import type { Place, PriceInfo, PriceLevel } from '@/types/domain';
import { parseOpeningHours } from './openingHours';
import { buildOverpassQuery, classify, type OsmTags } from './taxonomy';
import { buildSightsQuery, classifySight, isNotable, sightProfile, themesFor } from './sights';

type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: OsmTags;
};

type OverpassResponse = { elements?: OverpassElement[] };

/** Welche Art von Orten geladen wird – bestimmt Abfrage und Cache-Schlüssel. */
type Theme = 'places' | 'sights';

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

/**
 * Für Besichtigungstouren reicht ein kleinerer Umkreis – zu Fuß kommt man in
 * ein paar Stunden ohnehin nicht weiter. Kleinerer Umkreis heißt auch: Die
 * Abfrage bleibt sicher unter der Zeitgrenze der öffentlichen Instanzen.
 */
const SIGHTS_RADIUS_M = 2500;
const SIGHTS_LIMIT = 500;

/** Erhöhen, sobald sich ändert, welche Orte wie eingeordnet werden. */
const CACHE_VERSION = 'v2';

/** Zellgröße des Caches (~2,2 km). Kleine Ortswechsel treffen denselben Cache. */
const CACHE_CELL_DEGREES = 0.02;
/**
 * Wie lange eine geladene Kachel gilt. Großzügig, weil sich die Orte einer
 * Gegend kaum ändern – und weil Öffnungszeiten ohnehin erst beim Planen gegen
 * die aktuelle Uhrzeit geprüft werden, nicht beim Laden. Mit einer kurzen
 * Frist würde praktisch jeder erste Besucher des Tages auf Overpass warten.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

  /**
   * Der Cache kommt von außen, weil sein richtiger Ort von der Umgebung
   * abhängt – Arbeitsspeicher lokal, Datenbank auf einer serverlosen
   * Plattform. Siehe providers/placeCache.ts.
   */
  constructor(private readonly cache: PlaceCacheStore = new InMemoryPlaceCache()) {}

  /** Nur prozesslokal: verhindert doppelte Abfragen derselben Kachel. */
  private inflight = new Map<string, Promise<Place[]>>();

  async search(query: PlaceQuery): Promise<Place[]> {
    const radius = Math.min(
      query.radiusMeters,
      query.theme === 'sights' ? SIGHTS_RADIUS_M : MAX_RADIUS_M,
    );
    const places = await this.loadWithinBudget(
      query.center.lat,
      query.center.lon,
      INTERACTIVE_BUDGET_MS,
      query.theme ?? 'places',
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
  async prefetch(
    center: { lat: number; lon: number },
    theme: Theme = 'places',
  ): Promise<void> {
    try {
      await this.load(center.lat, center.lon, theme);
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
    theme: Theme,
  ): Promise<Place[]> {
    const request = this.load(lat, lon, theme);

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

  /** Lädt eine ganze Zelle und legt sie in den Cache. */
  private load(lat: number, lon: number, theme: Theme = 'places'): Promise<Place[]> {
    const cellLat = Math.round(lat / CACHE_CELL_DEGREES) * CACHE_CELL_DEGREES;
    const cellLon = Math.round(lon / CACHE_CELL_DEGREES) * CACHE_CELL_DEGREES;
    // Ausgehorte behalten ihren bisherigen Schlüssel, Sehenswürdigkeiten
    // bekommen ein Präfix – so bleiben bestehende Cache-Einträge gültig.
    // Die Version steigt, wenn sich die Einordnung der Orte ändert – so
    // verschwinden alte Einträge (etwa noch mit Fitnessstudios) aus dem Cache,
    // statt 24 Stunden lang weiter ausgeliefert zu werden.
    const cell = `${CACHE_VERSION}:${cellLat.toFixed(3)}:${cellLon.toFixed(3)}`;
    const key = theme === 'sights' ? `sights:${cell}` : cell;

    // Parallele Anfragen auf dieselbe Zelle teilen sich einen Vorgang.
    const running = this.inflight.get(key);
    if (running) return running;

    const request = this.loadCell(key, cellLat, cellLon, theme).finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, request);
    // Wenn der Aufrufer wegen Zeitbudget aussteigt, darf die Ablehnung
    // nicht als unbehandelt im Prozess landen.
    void request.catch(() => undefined);
    return request;
  }

  private async loadCell(
    key: string,
    lat: number,
    lon: number,
    theme: Theme,
  ): Promise<Place[]> {
    const cached = await this.cache.get(key, CACHE_TTL_MS);
    if (cached) return cached;

    const places = await this.fetchCell(lat, lon, theme);
    await this.cache.set(key, places);
    return places;
  }

  private async fetchCell(lat: number, lon: number, theme: Theme): Promise<Place[]> {
    const query =
      theme === 'sights'
        ? buildSightsQuery(lat, lon, SIGHTS_RADIUS_M, SIGHTS_LIMIT)
        : buildOverpassQuery(lat, lon, MAX_RADIUS_M, ELEMENT_LIMIT);
    const toModel = theme === 'sights' ? toSight : toPlace;
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
          .map((element) => toModel(element))
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
    // Für die Tourplanung: Orte ohne Wikipedia-Artikel werden zu Geheimtipps.
    notable: isNotable(tags),
    minAge: minAgeOf(tags, profile.minAge),
    bookable: profile.bookable,
  };
}

/**
 * Eine Sehenswürdigkeit aus OSM. Dieselben Regeln wie bei Ausgehorten:
 * Öffnungszeiten und Preise nur, wenn OSM sie liefert – sonst ehrlich leer.
 */
function toSight(element: OverpassElement): Place | null {
  const tags = element.tags;
  if (!tags?.name) return null;

  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (lat === undefined || lon === undefined) return null;

  const key = classifySight(tags);
  if (!key) return null;
  if (tags['disused:tourism'] || tags.abandoned || tags.access === 'private') return null;

  const profile = sightProfile(key);
  const notable = isNotable(tags);

  // Die meisten Denkmäler, Brücken und Aussichtspunkte kosten nichts; Museen
  // und Schlösser meist etwas. Das ist eine Schätzung und wird so ausgewiesen.
  const fallbackLevel = key === 'museum' || key === 'castle' || key === 'palace' || key === 'zoo' || key === 'ship' ? 1 : 0;

  return {
    id: `osm_${element.type[0]}${element.id}`,
    name: tags.name,
    category: profile.category,
    kind: profile.kind,
    emoji: profile.emoji,
    location: { lat, lon, address: addressOf(tags) },
    price: priceOf(tags, fallbackLevel),
    typicalDurationMin: profile.dwellMin,
    openingHours: parseOpeningHours(tags.opening_hours),
    indoorOutdoor: profile.indoorOutdoor,
    rainSuitability: profile.indoorOutdoor === 'indoor' ? 1 : profile.indoorOutdoor === 'mixed' ? 0.6 : 0.15,
    heatSuitability: profile.indoorOutdoor === 'indoor' ? 0.95 : 0.7,
    coldSuitability: profile.indoorOutdoor === 'indoor' ? 1 : 0.45,
    bestSeasons: [],
    scores: {
      romantic: profile.themes.includes('photo') ? 0.8 : 0.5,
      action: 0.2,
      family: 0.7,
      chill: profile.themes.includes('park') ? 0.9 : 0.6,
      // Unbekanntes ist neuer als das, was jeder schon gesehen hat.
      novelty: notable ? 0.5 : 0.85,
      social: 0.5,
    },
    source: 'openstreetmap',
    themes: themesFor(key, tags),
    notable,
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
