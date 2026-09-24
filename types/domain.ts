/**
 * Zentrale Domänentypen von WasJetzt.
 * Alles, was Engine, Provider und UI gemeinsam sprechen, steht hier.
 */

export type Coordinates = {
  lat: number;
  lon: number;
};

export type PlaceLocation = Coordinates & {
  /** Anzeigename der Umgebung, z. B. "Neustadt" – kein Pflichtfeld. */
  area?: string;
  /** Straße/Hausnummer, nur wenn die Quelle sie liefert. */
  address?: string;
};

/** Grobe Aktivitätskategorien. Bewusst klein gehalten. */
export type Category =
  | 'food'
  | 'cafe'
  | 'bar'
  | 'activity'
  | 'cinema'
  | 'culture'
  | 'nature'
  | 'sport'
  | 'gaming'
  | 'wellness'
  | 'shopping'
  | 'event';

export type IndoorOutdoor = 'indoor' | 'outdoor' | 'mixed';

export type Mobility = 'walk' | 'bike' | 'transit' | 'car';

export type Party = 'solo' | 'partner' | 'friends' | 'family';

export type Mood =
  | 'date'
  | 'action'
  | 'chill'
  | 'party'
  | 'food'
  | 'nature'
  | 'gaming'
  | 'new';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/**
 * Was ein Ort als Sehenswürdigkeit bietet. Wird aus OSM-Tags abgeleitet,
 * nicht von Hand vergeben – siehe providers/osm/sights.ts.
 *
 * `classic` und `hidden` schließen sich aus und hängen an einem überprüfbaren
 * Signal: Ist der Ort in OSM mit Wikipedia oder Wikidata verknüpft, gilt er
 * als bekannt, sonst als Geheimtipp.
 */
export type SightTheme = 'classic' | 'photo' | 'museum' | 'park' | 'history' | 'hidden';

/** Was der Plan ist: ein Abendprogramm oder eine Besichtigungstour. */
export type PlanMode = 'evening' | 'tour';

/** Nachträgliche Änderung einer ganzen Tour. */
export type TourTweak =
  | 'more'
  | 'less-walk'
  | 'museum'
  | 'photo'
  | 'free'
  | 'faster'
  | 'calm'
  | 'surprise';

/** 0 = Sonntag … 6 = Samstag (wie Date#getDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type OpeningInterval = {
  /** Minuten seit Mitternacht, lokale Zeit. */
  openMin: number;
  /** Minuten seit Mitternacht; Werte > 1440 bedeuten "bis nach Mitternacht". */
  closeMin: number;
};

export type OpeningHours = Partial<Record<Weekday, OpeningInterval[]>>;

/**
 * Preisniveau statt erfundener Eurobeträge:
 * 0 = kostenlos, 1 = € günstig, 2 = €€ mittel, 3 = €€€ teuer.
 */
export type PriceLevel = 0 | 1 | 2 | 3;

/**
 * Preisangabe eines Ortes.
 *
 * Grundregel: Es werden niemals Eurobeträge erfunden. `perPerson` ist nur
 * gesetzt, wenn die Quelle einen konkreten Preis liefert (z. B. das
 * OSM-Tag `charge`). Sonst gibt es ausschließlich ein geschätztes Niveau,
 * das die UI als € / €€ / €€€ und sichtbar als Schätzung ausweist.
 */
export type PriceInfo = {
  level: PriceLevel;
  /** true = aus Art des Ortes abgeleitet, nicht vom Betrieb angegeben. */
  levelEstimated: boolean;
  /** Echter Betrag pro Person, falls die Quelle ihn kennt. */
  perPerson?: { min: number; max: number };
};

export type Place = {
  id: string;
  name: string;
  category: Category;
  /** Feinere Bezeichnung für die UI, z. B. "Italienisch", "Bowling". */
  kind: string;
  emoji: string;
  location: PlaceLocation;
  price: PriceInfo;
  /** Typische Aufenthaltsdauer in Minuten. */
  typicalDurationMin: number;
  /**
   * null = Öffnungszeiten sind nicht bekannt. Dann wird nirgends behauptet,
   * der Ort sei geöffnet; die UI weist das aus.
   */
  openingHours: OpeningHours | null;
  indoorOutdoor: IndoorOutdoor;
  /** 0..1 – wie gut der Ort bei Regen funktioniert. */
  rainSuitability: number;
  /** 0..1 – wie gut der Ort bei Hitze funktioniert. */
  heatSuitability: number;
  /** 0..1 – wie gut der Ort bei Kälte funktioniert. */
  coldSuitability: number;
  /** Jahreszeiten, in denen der Ort besonders gut passt. Leer = ganzjährig. */
  bestSeasons: Season[];
  /** 0..1 Profilwerte für das Ranking. */
  scores: {
    romantic: number;
    action: number;
    family: number;
    chill: number;
    novelty: number;
    social: number;
  };
  /** 0..5, optional – nur gesetzt, wenn eine echte Quelle sie liefert. */
  rating?: number;
  ratingCount?: number;
  /** Herkunft der Daten. "mock" wird in der UI kenntlich gemacht. */
  source: DataSource;
  /** Nur bei Sehenswürdigkeiten gesetzt. */
  themes?: SightTheme[];
  /** Mit Wikipedia/Wikidata verknüpft – echtes Bekanntheitssignal aus OSM. */
  notable?: boolean;
  /**
   * Verknüpfter Wikipedia-Artikel aus OSM, z. B. "de:Brandenburger Tor".
   * Quelle für Vorschaubild und Kurzbeschreibung in der Tour-Ansicht.
   */
  wikipedia?: string;
  /**
   * Wie bekannt ein Ort über die Stadt hinaus ist, 0–1. Abgeleitet aus der
   * Zahl der Sprachen, in denen OSM-Mitwirkende seinen Namen eingetragen
   * haben – das Brandenburger Tor hat Dutzende, ein Kiezpark keine.
   */
  prominence?: number;
  /** Mindestalter, falls relevant (z. B. Bar/Club). */
  minAge?: number;
  bookable?: boolean;
  /** Kurzfristiges Angebot, falls vorhanden. */
  deal?: {
    label: string;
    discountPercent: number;
  };
};

export type DataSource = 'mock' | 'openstreetmap' | 'google-places' | 'mapbox' | 'partner';

export type WeatherCondition =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'snow'
  | 'thunderstorm'
  | 'fog'
  | 'unknown';

export type WeatherSlice = {
  /** ISO-Zeitstempel zum Beginn der Stunde. */
  time: string;
  temperatureC: number;
  condition: WeatherCondition;
  /** 0..100 */
  precipitationProbability: number;
  precipitationMm: number;
  windKmh: number;
  isDay: boolean;
};

export type WeatherForecast = {
  now: WeatherSlice;
  /** Stündliche Vorhersage, aufsteigend sortiert. */
  hourly: WeatherSlice[];
  sunriseISO?: string;
  sunsetISO?: string;
  /** Sonnenuntergänge aller Vorhersagetage – für Pläne, die morgen stattfinden. */
  sunsetsISO?: string[];
  /**
   * Versatz der Ortszeit gegenüber UTC. Grundlage für alles, was „wie spät
   * ist es dort?" fragt – der Server selbst läuft bei Vercel auf UTC.
   */
  utcOffsetSeconds?: number;
  source: 'open-meteo' | 'fallback';
};

export type TravelMode = Mobility;

export type TravelLeg = {
  mode: TravelMode;
  distanceMeters: number;
  durationMin: number;
  /** Grobe Schätzung – true, wenn kein echter Routing-Provider im Spiel war. */
  estimated: boolean;
  /**
   * Echte Wegführung als kodierte Polyline (Google-Format, 5 Nachkommastellen),
   * genau die Route, aus der Distanz und Dauer stammen. Fehlt bei Schätzungen.
   */
  geometry?: string;
};

export type PlanStep = {
  id: string;
  place: Place;
  /** ISO-Zeitstempel. */
  startISO: string;
  endISO: string;
  durationMin: number;
  /** Anreise zu diesem Schritt (vom vorherigen Punkt bzw. vom Start). */
  travelFromPrevious: TravelLeg;
  price: PriceInfo;
  /** false = Öffnungszeiten unbekannt; die UI sagt das dem Nutzer. */
  openingHoursKnown: boolean;
  /** Kurzer Satz, warum dieser Schritt gewählt wurde. */
  reason: string;
  /** Begründung als Schlüssel ins Wörterbuch. */
  reasonKey?: string;
};

export type PlanVariantKey = 'balanced' | 'romantic' | 'action' | 'cheap';

export type Plan = {
  id: string;
  /** Kurzer, teilbarer Code für den Link. */
  shareCode: string;
  title: string;
  /** Titel als Schlüssel – so erscheint er in der Sprache des Betrachters. */
  titleKey?: 'plan' | 'tour';
  titleParams?: Record<string, string>;
  /** Ein Satz, der den Plan beschreibt. */
  summary: string;
  variant: PlanVariantKey;
  /** Fehlt bei älteren Plänen – dann ist es ein Abendprogramm. */
  mode?: PlanMode;
  /** Zeitversatz des Ortes in Minuten – Uhrzeiten werden in Ortszeit angezeigt. */
  tzOffsetMin?: number;
  steps: PlanStep[];
  startISO: string;
  endISO: string;
  /**
   * Wann es losgeht – die gewählte Startzeit. `startISO` ist die Ankunft an
   * der ersten Station, also Startzeit plus Weg.
   */
  departISO?: string;
  /** Weg zurück, wenn eine Heimkehrzeit gesetzt ist. */
  returnHome?: {
    durationMin: number;
    distanceMeters: number;
    estimated: boolean;
    arriveISO: string;
    geometry?: string;
  };
  totalDurationMin: number;
  cost: PlanCost;
  currency: string;
  request: PlanRequest;
  weatherAtCreation: WeatherSlice | null;
  createdAtISO: string;
  /** Bis wann der geteilte Link funktioniert. Setzt der Speicher beim Sichern. */
  expiresAtISO?: string;
  /** Hinweise, die die UI unaufdringlich anzeigen darf. */
  notes: PlanNote[];
  meetingPoint?: MeetingPoint;
  participants: Participant[];
  /** true, wenn mindestens ein Schritt aus Mock-Daten stammt. */
  containsMockData: boolean;
  /** Alternative Varianten desselben Wunsches, zum direkten Umschalten. */
  siblings?: PlanSibling[];
};

export type PlanSibling = {
  variant: PlanVariantKey;
  id: string;
  title: string;
  emoji: string;
};

export type PlanCost = {
  /** Gesamtniveau des Plans – immer vorhanden. */
  level: PriceLevel;
  /** true, wenn mindestens ein Schritt nur ein geschätztes Niveau hat. */
  levelEstimated: boolean;
  /** Summe pro Person, nur wenn für JEDEN Schritt ein echter Betrag vorliegt. */
  perPerson?: { min: number; max: number };
  /** Summe für die ganze Gruppe – dasselbe mal Personenzahl. */
  total?: { min: number; max: number };
  /** Personenzahl, auf die sich `total` bezieht. */
  groupSize?: number;
};

export type PlanNote = {
  kind: 'info' | 'weather' | 'budget' | 'time' | 'availability';
  /** Text in der Sprache der Anfrage – Rückfall für ältere Pläne. */
  text: string;
  /** Schlüssel ins Wörterbuch; die Oberfläche übersetzt damit in die Sprache des Betrachters. */
  key?: string;
  params?: Record<string, string | number>;
};

export type MeetingPoint = {
  label: string;
  location: Coordinates;
  timeISO: string;
};

export type RsvpStatus = 'yes' | 'maybe' | 'no';

export type Participant = {
  id: string;
  name: string;
  rsvp: RsvpStatus;
  /** Optional: eigene Anreise. */
  travel?: {
    mode: Mobility;
    durationMin: number;
  };
  /** Optionale Stimme beim Gruppenvoting. */
  vote?: Category | null;
};

export type BudgetPreset = 'free' | 'low' | 'medium' | 'high' | 'any';

export type PlanRequest = {
  origin: Coordinates;
  /** Anzeigename des Startorts, z. B. eine Adresse oder eine Stadt. */
  originLabel: string;
  /** true = per GPS ermittelt. Dann steht statt einer Adresse "dein aktueller Standort". */
  originFromDevice?: boolean;
  /** ISO – Startzeitpunkt der Planung. */
  startISO: string;
  /** Verfügbare Zeit in Minuten. */
  availableMinutes: number;
  party: Party;
  groupSize: number;
  budget: BudgetPreset;
  /** Optionales hartes Limit pro Person. */
  budgetPerPerson?: number;
  /**
   * Gesamtbudget der Gruppe. „2 Personen · 100 €" heißt 100 € für den Abend,
   * nicht 100 € je Kopf – die Engine teilt intern durch die Personenzahl.
   */
  budgetTotal?: number;
  /**
   * Soll Essen Teil des Plans sein? Die ausdrückliche Antwort schlägt die
   * Uhrzeit-Heuristik; ohne Angabe entscheidet weiter die Tageszeit.
   */
  wantsFood?: boolean;
  /**
   * Größerer Suchradius, wenn in der Nähe nichts Passendes lag – der Nutzer
   * hat dem ausdrücklich zugestimmt. 1 = normal, 2 = doppelt.
   */
  radiusBoost?: number;
  moods: Mood[];
  mobility: Mobility;
  /** ISO – "wir müssen um X zuhause sein". */
  mustBeHomeByISO?: string;
  /**
   * Gewünschte Startzeit als Ortszeit des Standorts, z. B. "14:30". Der
   * Server rechnet sie mit der Zeitzone des Ortes in `startISO` um – das Gerät
   * des Nutzers kann in einer anderen Zeitzone sein.
   */
  startLocal?: string;
  /** Heimkehrzeit als Ortszeit, z. B. "21:00". Wird zu `mustBeHomeByISO`. */
  homeByLocal?: string;
  /** Wenn gesetzt, endet der Plan Richtung Zuhause. */
  homeLocation?: Coordinates;
  /** Nur eine einzelne Aktivität statt eines ganzen Abends. */
  singleActivity?: boolean;
  /** Bevorzugt Unbekanntes. */
  preferNovelty?: boolean;
  /** Kategorie-Wunsch aus einer Kachel ("Essen", "Kino", …). */
  focusCategory?: Category;
  /** Freitext des Nutzers, falls er einfach geschrieben hat. */
  rawText?: string;
  language: string;
  currency: string;
  /** Alter des Nutzers, nur falls freiwillig hinterlegt. */
  age?: number;
  touristMode?: boolean;
  /**
   * Zeitversatz des Geräts in Minuten (MEZ = 60, MESZ = 120). Rückfall, wenn
   * der Wetterdienst die Ortszeit nicht liefert.
   */
  tzOffsetMin?: number;
  /** Besichtigungstour statt Abendprogramm. */
  mode?: PlanMode;
  /** Was der Nutzer sehen will. Leer oder fehlend = überraschen lassen. */
  interests?: SightTheme[];
  /** Orte, die nicht noch einmal vorkommen sollen (etwa aus Tag 1). */
  excludePlaceIds?: string[];
  /** Nachträgliche Anpassung einer bestehenden Tour. */
  tourTweak?: TourTweak;
};

export type UserPreferences = {
  /** Kategorien, die der Nutzer mag – Gewicht 0..1. */
  likes: Partial<Record<Category, number>>;
  /** Kategorien, die er ablehnt – Gewicht 0..1. */
  dislikes: Partial<Record<Category, number>>;
  /** Wie stark Entfernung stört (0..1, höher = empfindlicher). */
  distanceSensitivity: number;
  /** Wie stark Preis stört (0..1). */
  priceSensitivity: number;
  defaultMobility: Mobility;
  defaultParty: Party;
  /** Zuletzt besuchte/geplante Orte – für "etwas Neues". */
  recentPlaceIds: string[];
  recentCategories: Category[];
  age?: number;
  language: string;
  homeLocation?: Coordinates;
  /** Anzeigename des Zuhauses, z. B. "Müllerstraße 120, 13349 Berlin". */
  homeLabel?: string;
  shareLocationLive: boolean;
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  likes: {},
  dislikes: {},
  distanceSensitivity: 0.5,
  priceSensitivity: 0.5,
  defaultMobility: 'transit',
  defaultParty: 'friends',
  recentPlaceIds: [],
  recentCategories: [],
  language: 'de',
  shareLocationLive: false,
};
