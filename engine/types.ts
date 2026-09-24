import type {
  Category,
  SequenceKind,
  Place,
  PlanRequest,
  PlanVariantKey,
  Season,
  UserPreferences,
  WeatherForecast,
  WeatherSlice,
} from '@/types/domain';
import type { DayPart } from '@/lib/time';
import type { PlanIntent } from './intent';

/** Alles, was die Engine zum Rechnen braucht – einmal aufgebaut, dann read-only. */
export type PlanContext = {
  request: PlanRequest;
  preferences: UserPreferences;
  pool: Place[];
  weather: WeatherForecast;
  season: Season;
  dayPart: DayPart;
  start: Date;
  /** Späteste Endzeit des Plans (aus Zeitbudget und/oder "zuhause bis"). */
  latestEnd: Date;
  radiusMeters: number;
  /** Harte Obergrenze pro Person, falls gesetzt. */
  budgetCap?: number;
  /** Strukturierte Absicht des Nutzers – Grundlage der Slot-Struktur. */
  intent: PlanIntent;
  /** Nur bei Touren: Sehenswürdigkeiten, getrennt von den Ausgehorten. */
  sights?: Place[];
  /** Die Sehenswürdigkeiten konnten gerade nicht geladen werden. */
  sightsUnavailable?: boolean;
  /**
   * Versatz der Ortszeit gegenüber UTC in Minuten. Jede Frage nach Uhrzeit
   * oder Wochentag geht über diesen Wert – nie über die Uhr des Servers.
   */
  tzOffsetMin: number;
};

/** Ein Slot ist eine Position im Plan mit erlaubten Kategorien. */
export type Slot = {
  /** Kategorien in absteigender Präferenz. Erste Wahl gewinnt im Ranking. */
  roles: Category[];
  /**
   * Breitere Auswahl, wenn sich der Slot sonst gar nicht füllen ließe.
   * Nur Pflicht-Slots haben eine – optionale Slots entfallen lieber, als
   * mit etwas gefüllt zu werden, das niemand wollte.
   */
  fallbackRoles?: Category[];
  /** Zielminuten für diesen Schritt (die tatsächliche Dauer kommt vom Ort). */
  targetMinutes: number;
  /** Slots, die notfalls entfallen dürfen. */
  optional: boolean;
  /** Rolle im Plan – nur für Begründungstexte. */
  label: 'food' | 'main' | 'secondary' | 'winddown';
  /**
   * Welchen Wunsch dieser Slot erfüllt. Ohne erfüllten Wunsch gehört eine
   * Station nicht in den Plan – daran hängt auch der ehrliche Hinweis,
   * wenn sich ein Wunsch nicht erfüllen ließ.
   */
  need?: 'food' | 'experience' | 'main' | 'extra' | 'winddown' | 'sequence';
  /** Bei einem gewuenschten Ablauf: welche Position dieser Slot erfuellt. */
  sequenceKind?: SequenceKind;
};

export type ScoringWeights = {
  mood: number;
  distance: number;
  price: number;
  weather: number;
  season: number;
  novelty: number;
  preference: number;
  role: number;
  deal: number;
  rating: number;
  /** Wie gut der Ort zur Gruppengröße passt. */
  group: number;
};

export type Candidate = {
  place: Place;
  score: number;
  breakdown: Partial<Record<keyof ScoringWeights, number>>;
  distanceMeters: number;
  travelMin: number;
  startISO: string;
  durationMin: number;
  weatherAtStart: WeatherSlice | null;
};

export type VariantProfile = {
  key: PlanVariantKey;
  title: string;
  emoji: string;
  weights: Partial<ScoringWeights>;
  /** Score-Bonus, der direkt auf Ortseigenschaften wirkt. */
  bias: Partial<Record<keyof Place['scores'], number>>;
  /** Harte Budgetsenkung für die Sparvariante. */
  maxPriceLevel?: number;
};
