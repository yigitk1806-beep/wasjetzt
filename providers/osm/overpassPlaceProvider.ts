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
 */
const MAX_RADIUS_M = 4500;

/**
 * Die Suche beginnt klein und wächst nur, wenn es nötig ist.
 *
 * Warum: In einer dichten Innenstadt liegen im 4,5-km-Kasten rund 7900
 * passende Orte – weit mehr, als eine Abfrage ausliefern kann. Früher wurde
 * dann ein zusammenhängender Teil der Stadt abgeschnitten, oft genau die
 * Umgebung des Nutzers: Am Brandenburger Tor fand ein Fußgänger-Plan gar
 * nichts, obwohl ringsum hunderte Lokale liegen.
 *
 * Jetzt wird zuerst nur die nähere Umgebung geladen (vollständig, schnell).
 * Reicht das nicht – Dorf, Stadtrand, weite Anreise –, wächst der Radius
 * stufenweise, und die Ergebnisse werden zusammengeführt.
 */
const RADIUS_STUFEN = [1100, 2400, MAX_RADIUS_M] as const;

/**
 * Ab wann die nähere Umgebung genügt: genug Orte und genug verschiedene
 * Arten, damit ein abwechslungsreicher Plan entstehen kann.
 */
const GENUG_ORTE = 45;
const GENUG_ARTEN = 4;

/**
 * Für Besichtigungstouren reicht ein kleinerer Umkreis – zu Fuß kommt man in
 * ein paar Stunden ohnehin nicht weiter. Kleinerer Umkreis heißt auch: Die
 * Abfrage bleibt sicher unter der Zeitgrenze der öffentlichen Instanzen.
 */
const SIGHTS_RADIUS_M = 2500;
const SIGHTS_LIMIT = 500;

/** Erhöhen, sobald sich ändert, welche Orte wie eingeordnet werden. */
const CACHE_VERSION = 'v8';

/**
 * Zellgröße des Caches je Stufe. Die nahe Stufe braucht ein feines Raster
 * (~0,5 km): Der geladene Kasten liegt dann auch im ungünstigsten Fall noch
 * rund einen Kilometer um den Nutzer herum. Die weiten Stufen teilen sich
 * größere Kacheln (~2,2 km), dort fällt der Versatz nicht ins Gewicht.
 */
const ZELLE_NAH = 0.005;
const ZELLE_WEIT = 0.02;
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
 *
 * Die 14 Sekunden sind gemessen: Für eine dichte Innenstadt (Kopenhagen,
 * Neapel) braucht die öffentliche Instanz selbst bei freien Plätzen 9–10
 * Sekunden. Mit einem knapperen Budget bekäme der erste Besucher einer Gegend
 * Ersatzdaten, obwohl echte Daten eine Sekunde später da gewesen wären.
 */
const INTERACTIVE_BUDGET_MS = 14_000;

/**
 * So lange wird eine gescheiterte Abfrage nicht wiederholt. Kurz genug, dass
 * sich eine Gegend nach einer Überlastphase von selbst erholt.
 */
const FEHLER_PAUSE_MS = 3 * 60_000;

/**
 * Beim Vorladen wird nicht gleich der größte Ring geholt: Auf dem Land kostet
 * er am meisten und wird am seltensten gebraucht. Er kommt erst, wenn ein
 * Klick wirklich so weit hinausschaut.
 */
const PREFETCH_RADIUS_M = 2400;

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

  /**
   * Kürzlich gescheiterte Abfragen. Die öffentlichen Instanzen antworten bei
   * Überlast mit 504 – erst nach allen Versuchen und Ausweichservern, also
   * nach gut einer halben Minute. Ohne dieses Gedächtnis liefe jeder weitere
   * Aufruf derselben Gegend erneut in dieselbe halbe Minute.
   */
  private gescheitert = new Map<string, number>();

  async search(query: PlaceQuery): Promise<Place[]> {
    const theme = query.theme ?? 'places';
    const radius = Math.min(
      query.radiusMeters,
      theme === 'sights' ? SIGHTS_RADIUS_M : MAX_RADIUS_M,
    );
    const places = await this.sammeln(
      query.center,
      radius,
      theme,
      query.maxWaitMs ?? INTERACTIVE_BUDGET_MS,
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
   * Sammelt Orte in wachsenden Ringen: erst die nähere Umgebung, dann – nur
   * falls dort zu wenig Brauchbares liegt – größere Stufen. Die Ergebnisse
   * werden zusammengeführt, Doppelte fallen über die OSM-Kennung heraus.
   *
   * Schlägt eine spätere Stufe fehl oder reißt das Zeitbudget, bleibt es bei
   * dem, was schon da ist – das ist besser als gar kein Ergebnis. Nur wenn
   * die erste Stufe scheitert, wird der Fehler weitergereicht: Dann ist
   * Overpass nicht erreichbar, und die Ersatzquelle soll übernehmen.
   */
  private async sammeln(
    center: { lat: number; lon: number },
    radius: number,
    theme: Theme,
    budgetMs: number,
  ): Promise<Place[]> {
    // Sehenswürdigkeiten kommen aus einer eigenen, bereits engen Abfrage.
    if (theme === 'sights') {
      return this.loadWithinBudget(center.lat, center.lon, budgetMs, theme, SIGHTS_RADIUS_M);
    }

    const beginn = Date.now();
    const gesammelt = new Map<string, Place>();
    const stufen = RADIUS_STUFEN.filter(
      (stufe, i) => stufe <= radius || i === 0 || RADIUS_STUFEN[i - 1] < radius,
    );

    for (const [i, stufe] of stufen.entries()) {
      const rest = budgetMs - (Date.now() - beginn);
      if (i > 0 && rest < 1500) break;

      try {
        const batch = await this.loadWithinBudget(
          center.lat,
          center.lon,
          i === 0 ? budgetMs : rest,
          theme,
          stufe,
        );
        for (const place of batch) gesammelt.set(place.id, place);
      } catch (error) {
        if (i === 0) throw error;
        break;
      }

      if (this.genug(gesammelt, center, radius)) break;
    }

    return [...gesammelt.values()];
  }

  /** Genug Auswahl in Reichweite – oder muss der Ring größer werden? */
  private genug(
    places: Map<string, Place>,
    center: { lat: number; lon: number },
    radius: number,
  ): boolean {
    const inReichweite = [...places.values()].filter(
      (place) => haversineMeters(center, place.location) <= radius,
    );
    if (inReichweite.length < GENUG_ORTE) return false;
    return new Set(inReichweite.map((place) => place.category)).size >= GENUG_ARTEN;
  }

  /**
   * Lädt die Gegend im Hintergrund vor. Wird beim Öffnen der App aufgerufen,
   * damit „Jetzt los" später auf einen warmen Cache trifft. Fehler sind hier
   * bedeutungslos – es ist nur ein Vorabversuch.
   *
   * Vorgeladen wird genau das, was ein Klick danach braucht: dieselben Stufen
   * in derselben Reihenfolge, nur ohne Zeitbudget.
   */
  async prefetch(
    center: { lat: number; lon: number },
    theme: Theme = 'places',
  ): Promise<void> {
    try {
      await this.sammeln(center, PREFETCH_RADIUS_M, theme, Number.POSITIVE_INFINITY);
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
    radius: number,
  ): Promise<Place[]> {
    const request = this.load(lat, lon, theme, radius);
    if (!Number.isFinite(budgetMs)) return request;

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

  /** Lädt eine Zelle einer Stufe und legt sie in den Cache. */
  private load(lat: number, lon: number, theme: Theme, radius: number): Promise<Place[]> {
    // Die nahe Stufe bekommt ein feineres Raster, damit die geladene Umgebung
    // tatsächlich um den Nutzer liegt und nicht um eine weit entfernte Ecke.
    const raster = radius <= RADIUS_STUFEN[0] ? ZELLE_NAH : ZELLE_WEIT;
    const cellLat = Math.round(lat / raster) * raster;
    const cellLon = Math.round(lon / raster) * raster;
    // Die Version steigt, wenn sich die Einordnung der Orte oder der Zuschnitt
    // der Abfrage ändert – so verschwinden alte Einträge aus dem Cache, statt
    // 24 Stunden lang weiter ausgeliefert zu werden.
    const cell = `${CACHE_VERSION}:${Math.round(radius)}:${cellLat.toFixed(3)}:${cellLon.toFixed(3)}`;
    const key = theme === 'sights' ? `sights:${cell}` : cell;

    // Kürzlich gescheitert? Dann nicht erneut minutenlang warten.
    const letzterFehler = this.gescheitert.get(key);
    if (letzterFehler !== undefined && Date.now() - letzterFehler < FEHLER_PAUSE_MS) {
      return Promise.reject(new OverpassUnavailableError(`${key}: kürzlich gescheitert`));
    }

    // Parallele Anfragen auf dieselbe Zelle teilen sich einen Vorgang.
    const running = this.inflight.get(key);
    if (running) return running;

    const request = this.loadCell(key, cellLat, cellLon, theme, radius)
      .then((places) => {
        this.gescheitert.delete(key);
        return places;
      })
      .catch((error: unknown) => {
        this.gescheitert.set(key, Date.now());
        throw error;
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

  private async loadCell(
    key: string,
    lat: number,
    lon: number,
    theme: Theme,
    radius: number,
  ): Promise<Place[]> {
    const cached = await this.cache.get(key, CACHE_TTL_MS);
    if (cached) return cached;

    const places = await this.fetchCell(lat, lon, theme, radius);
    await this.cache.set(key, places);
    return places;
  }

  private async fetchCell(
    lat: number,
    lon: number,
    theme: Theme,
    radius: number,
  ): Promise<Place[]> {
    const query =
      theme === 'sights'
        ? buildSightsQuery(lat, lon, SIGHTS_RADIUS_M, SIGHTS_LIMIT)
        : buildOverpassQuery(lat, lon, radius);
    const toModel = theme === 'sights' ? toSight : toPlace;
    let lastError: unknown = null;

    // Der Hauptserver wird bei Überlast (429/504) ein zweites Mal versucht,
    // bevor die Ausweichserver dran sind. Pro Nutzer sind dort nur zwei
    // gleichzeitige Abfragen erlaubt – eine kurze Pause reicht oft.
    const versuche = [ENDPOINTS[0], ENDPOINTS[0], ...ENDPOINTS.slice(1)];
    for (const [index, endpoint] of versuche.entries()) {
      if (index === 1) await new Promise((r) => setTimeout(r, 1500));
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // Overpass bittet um eine identifizierbare Anwendung.
            'User-Agent': 'WasJetzt/0.1 (Freizeitplaner; +https://wasjetzt.app)',
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(index <= 1 ? PRIMARY_TIMEOUT_MS : MIRROR_TIMEOUT_MS),
        });

        if (!res.ok) {
          // Nur Überlast ist einen zweiten Versuch am selben Server wert.
          if (index === 0 && res.status !== 429 && res.status !== 504) {
            lastError = new Error(`${endpoint} → ${res.status}`);
            continue;
          }
          throw new Error(`${endpoint} → ${res.status}`);
        }

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

  // Die meisten Denkmäler, Brücken und Aussichtspunkte kosten nichts; Museen,
  // Schlösser, Türme und Attraktionen (Miniatur Wunderland, Fernsehturm …)
  // meist etwas. Das ist eine Schätzung und wird so ausgewiesen.
  const kostetMeist = ['museum', 'castle', 'palace', 'zoo', 'ship', 'tower', 'attraction'];
  const fallbackLevel = kostetMeist.includes(key) ? 1 : 0;

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
    wikipedia: wikipediaOf(tags),
    prominence: prominenceOf(tags),
  };
}

/**
 * Bekanntheit aus echten Daten: In wie vielen Sprachen gibt es einen Namen
 * oder Wikipedia-Artikel? Weltbekannte Orte haben Dutzende, lokale kaum welche.
 */
function prominenceOf(tags: OsmTags): number {
  let sprachen = 0;
  for (const key of Object.keys(tags)) {
    if (/^(name|wikipedia):[a-z]{2,3}(-[A-Za-z]+)?$/.test(key)) sprachen += 1;
  }
  return Math.min(1, sprachen / 25);
}

/** "de:Brandenburger Tor" – bevorzugt der Haupteintrag, sonst ein Sprach-Tag. */
function wikipediaOf(tags: OsmTags): string | undefined {
  if (tags.wikipedia?.includes(':')) return tags.wikipedia;
  if (tags['wikipedia:de']) return `de:${tags['wikipedia:de']}`;
  const sprach = Object.keys(tags).find((k) => k.startsWith('wikipedia:'));
  return sprach ? `${sprach.slice('wikipedia:'.length)}:${tags[sprach]}` : undefined;
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
  const strasse = number ? `${street} ${number}` : street;

  // Postleitzahl und Ort nur, wenn OSM sie wirklich hat – nichts ergänzen.
  const ort = [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' ');
  return ort ? `${strasse}, ${ort}` : strasse;
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
