import type {
  Category,
  Place,
  PlanRequest,
  PlanVariantKey,
  Season,
  UserPreferences,
  WeatherForecast,
  WeatherSlice,
} from '@/types/domain';
import type { DayPart } from '@/lib/time';

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
};

/** Ein Slot ist eine Position im Plan mit erlaubten Kategorien. */
export type Slot = {
  /** Kategorien in absteigender Präferenz. */
  roles: Category[];
  /** Zielminuten für diesen Schritt (die tatsächliche Dauer kommt vom Ort). */
  targetMinutes: number;
  /** Slots, die notfalls entfallen dürfen. */
  optional: boolean;
  /** Rolle im Plan – nur für Begründungstexte. */
  label: 'food' | 'main' | 'secondary' | 'winddown';
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
