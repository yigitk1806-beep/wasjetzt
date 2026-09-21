import type {
  Category,
  Coordinates,
  Mobility,
  Place,
  TravelLeg,
  WeatherForecast,
} from '@/types/domain';

export type { Coordinates };

/**
 * Austauschbare Datenquellen. Die Engine kennt nur diese Interfaces,
 * nie eine konkrete API. Neue Provider werden in providers/registry.ts
 * registriert und können dort ohne Änderung an der Engine getauscht werden.
 */

export type PlaceQuery = {
  center: Coordinates;
  radiusMeters: number;
  /**
   * `sights` liefert Sehenswürdigkeiten statt Ausgehorte – eigene Abfrage,
   * eigener Cache, damit sich beides nicht die Plätze im Ergebnis streitig macht.
   */
  theme?: 'sights';
  categories?: Category[];
  /** ISO-Zeitpunkt, zu dem der Ort geöffnet sein sollte (nur Vorfilter). */
  openAtISO?: string;
  limit?: number;
  locale?: string;
};

export interface PlaceProvider {
  readonly id: string;
  /** true, wenn die Daten nicht aus einer echten Quelle stammen. */
  readonly isMock: boolean;
  search(query: PlaceQuery): Promise<Place[]>;
  getById?(id: string): Promise<Place | null>;
  /**
   * Optional: Daten für eine Gegend im Hintergrund vorladen, damit die
   * erste echte Anfrage des Nutzers nicht auf das Netz warten muss.
   * Darf ohne Folgen scheitern.
   */
  prefetch?(center: Coordinates, theme?: 'places' | 'sights'): Promise<void>;
}

export interface WeatherProvider {
  readonly id: string;
  forecast(at: Coordinates, hours?: number): Promise<WeatherForecast>;
}

export type EventQuery = {
  center: Coordinates;
  radiusMeters: number;
  fromISO: string;
  toISO: string;
  limit?: number;
};

export interface EventProvider {
  readonly id: string;
  readonly isMock: boolean;
  /** Events werden als Place mit category "event" geliefert. */
  search(query: EventQuery): Promise<Place[]>;
}

export type RouteQuery = {
  from: Coordinates;
  to: Coordinates;
  mode: Mobility;
  departISO?: string;
};

export interface RoutingProvider {
  readonly id: string;
  route(query: RouteQuery): Promise<TravelLeg>;
  /** Mehrere Legs auf einmal – Provider dürfen das batchen. */
  routeMany(queries: RouteQuery[]): Promise<TravelLeg[]>;
}

export type GeocodeResult = {
  label: string;
  location: Coordinates;
  country?: string;
  admin?: string;
};

export interface GeocodingProvider {
  readonly id: string;
  search(query: string, locale?: string): Promise<GeocodeResult[]>;
  reverse(at: Coordinates, locale?: string): Promise<GeocodeResult | null>;
}

export type BookingOffer = {
  placeId: string;
  provider: string;
  url: string;
  label: string;
  pricePerPerson?: number;
};

export interface BookingProvider {
  readonly id: string;
  readonly isMock: boolean;
  offersFor(placeIds: string[]): Promise<BookingOffer[]>;
}

/**
 * Übersetzt Freitext in Planparameter. Default ist eine regelbasierte
 * Implementierung ohne externe API; ein LLM-Provider kann hier andocken.
 */
export interface LanguageProvider {
  readonly id: string;
  parse(text: string, locale: string): Promise<ParsedIntent>;
}

export type ParsedIntent = {
  party?: import('@/types/domain').Party;
  groupSize?: number;
  budget?: import('@/types/domain').BudgetPreset;
  budgetPerPerson?: number;
  availableMinutes?: number;
  moods: import('@/types/domain').Mood[];
  mobility?: Mobility;
  focusCategory?: Category;
  /** "bis 22 Uhr zuhause" → Uhrzeit in Minuten seit Mitternacht. */
  homeByMinutes?: number;
  preferNovelty?: boolean;
  avoidOutdoor?: boolean;
  maxDistanceMeters?: number;
  /** Was der Parser tatsächlich verstanden hat – für die UI. */
  understood: string[];
  confidence: number;
};
