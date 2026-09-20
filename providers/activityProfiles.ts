import type {
  Category,
  IndoorOutdoor,
  PriceLevel,
  Season,
} from '@/types/domain';

/**
 * Gemeinsame Eigenschaften einer Aktivitätsart – unabhängig davon, aus welcher
 * Quelle ein konkreter Ort stammt. OSM-Tags und Demo-Daten mappen beide auf
 * diese Profile, damit die Engine überall dieselben Kennzahlen bekommt.
 *
 * Wichtig: `priceLevel` ist hier eine *Schätzung aus der Art des Ortes*
 * (€ / €€ / €€€), kein vom Betrieb angegebener Preis. Orte, die eine echte
 * Preisangabe mitbringen, überschreiben das im jeweiligen Provider.
 */
export type ActivityProfile = {
  category: Category;
  /** Feinbezeichnung für die UI, z. B. "Bowling". */
  kind: string;
  emoji: string;
  priceLevel: PriceLevel;
  typicalDurationMin: number;
  indoorOutdoor: IndoorOutdoor;
  /** 0..1 – wie gut der Ort bei Regen / Hitze / Kälte funktioniert. */
  rainSuitability: number;
  heatSuitability: number;
  coldSuitability: number;
  /** Leer = ganzjährig sinnvoll. */
  bestSeasons: Season[];
  scores: {
    romantic: number;
    action: number;
    family: number;
    chill: number;
    novelty: number;
    social: number;
  };
  minAge?: number;
  bookable?: boolean;
};

export type ProfileKey = keyof typeof ACTIVITY_PROFILES;

/**
 * Zugriff auf ein Profil. Die Funktion vereinheitlicht den Typ – die Tabelle
 * selbst behält über `satisfies` ihre exakten Schlüssel für `ProfileKey`.
 */
export function profileFor(key: ProfileKey): ActivityProfile {
  return ACTIVITY_PROFILES[key];
}

const INDOOR = { rainSuitability: 1, heatSuitability: 0.95, coldSuitability: 1 };
const OUTDOOR = { rainSuitability: 0.08, heatSuitability: 0.85, coldSuitability: 0.25 };
const MIXED = { rainSuitability: 0.6, heatSuitability: 0.85, coldSuitability: 0.6 };

export const ACTIVITY_PROFILES = {
  // ------------------------------------------------------------------ Essen
  restaurant: {
    category: 'food', kind: 'Restaurant', emoji: '🍽️', priceLevel: 2,
    typicalDurationMin: 90, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.7, action: 0.1, family: 0.7, chill: 0.7, novelty: 0.4, social: 0.8 },
    bookable: true,
  },
  italian: {
    category: 'food', kind: 'Italienisch', emoji: '🍝', priceLevel: 2,
    typicalDurationMin: 90, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.8, action: 0.1, family: 0.7, chill: 0.7, novelty: 0.3, social: 0.8 },
    bookable: true,
  },
  pizza: {
    category: 'food', kind: 'Pizza', emoji: '🍕', priceLevel: 1,
    typicalDurationMin: 65, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.4, action: 0.1, family: 0.9, chill: 0.7, novelty: 0.2, social: 0.9 },
  },
  asian: {
    category: 'food', kind: 'Asiatisch', emoji: '🍜', priceLevel: 1,
    typicalDurationMin: 70, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.5, action: 0.1, family: 0.7, chill: 0.7, novelty: 0.5, social: 0.8 },
  },
  burger: {
    category: 'food', kind: 'Burger', emoji: '🍔', priceLevel: 1,
    typicalDurationMin: 60, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.2, action: 0.2, family: 0.8, chill: 0.6, novelty: 0.3, social: 0.9 },
  },
  fastfood: {
    category: 'food', kind: 'Imbiss', emoji: '🌯', priceLevel: 1,
    typicalDurationMin: 40, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.1, action: 0.2, family: 0.7, chill: 0.4, novelty: 0.3, social: 0.7 },
  },
  fine_dining: {
    category: 'food', kind: 'Gehobene Küche', emoji: '🥂', priceLevel: 3,
    typicalDurationMin: 120, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.95, action: 0.05, family: 0.3, chill: 0.6, novelty: 0.6, social: 0.5 },
    bookable: true,
  },
  streetfood: {
    category: 'food', kind: 'Streetfood', emoji: '🌮', priceLevel: 1,
    typicalDurationMin: 55, indoorOutdoor: 'outdoor', ...OUTDOOR,
    bestSeasons: ['spring', 'summer'],
    scores: { romantic: 0.3, action: 0.3, family: 0.7, chill: 0.6, novelty: 0.7, social: 0.9 },
  },

  // ------------------------------------------------------------------- Café
  cafe: {
    category: 'cafe', kind: 'Café', emoji: '☕', priceLevel: 1,
    typicalDurationMin: 50, indoorOutdoor: 'mixed', rainSuitability: 0.9,
    heatSuitability: 0.7, coldSuitability: 0.9, bestSeasons: ['autumn', 'winter'],
    scores: { romantic: 0.7, action: 0.05, family: 0.7, chill: 0.95, novelty: 0.3, social: 0.8 },
  },
  icecream: {
    category: 'cafe', kind: 'Eisdiele', emoji: '🍦', priceLevel: 1,
    typicalDurationMin: 30, indoorOutdoor: 'mixed', rainSuitability: 0.4,
    heatSuitability: 1, coldSuitability: 0.2, bestSeasons: ['spring', 'summer'],
    scores: { romantic: 0.6, action: 0.1, family: 0.95, chill: 0.9, novelty: 0.3, social: 0.8 },
  },

  // -------------------------------------------------------------------- Bar
  bar: {
    category: 'bar', kind: 'Bar', emoji: '🍹', priceLevel: 2,
    typicalDurationMin: 80, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.8, action: 0.3, family: 0.05, chill: 0.7, novelty: 0.5, social: 0.9 },
    minAge: 18,
  },
  pub: {
    category: 'bar', kind: 'Pub', emoji: '🍺', priceLevel: 1,
    typicalDurationMin: 90, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.5, action: 0.3, family: 0.1, chill: 0.8, novelty: 0.4, social: 0.95 },
    minAge: 16,
  },
  biergarten: {
    category: 'bar', kind: 'Biergarten', emoji: '🍺', priceLevel: 1,
    typicalDurationMin: 90, indoorOutdoor: 'outdoor', ...OUTDOOR,
    bestSeasons: ['spring', 'summer'],
    scores: { romantic: 0.6, action: 0.2, family: 0.5, chill: 0.9, novelty: 0.4, social: 0.95 },
    minAge: 16,
  },
  nightclub: {
    category: 'bar', kind: 'Club', emoji: '🪩', priceLevel: 2,
    typicalDurationMin: 150, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.2, action: 0.7, family: 0, chill: 0.1, novelty: 0.6, social: 0.95 },
    minAge: 18,
  },

  // ------------------------------------------------------------- Aktivität
  bowling: {
    category: 'activity', kind: 'Bowling', emoji: '🎳', priceLevel: 2,
    typicalDurationMin: 100, indoorOutdoor: 'indoor', ...INDOOR,
    bestSeasons: ['autumn', 'winter'],
    scores: { romantic: 0.4, action: 0.8, family: 0.9, chill: 0.3, novelty: 0.4, social: 0.95 },
    bookable: true,
  },
  escape: {
    category: 'activity', kind: 'Escape Room', emoji: '🗝️', priceLevel: 2,
    typicalDurationMin: 75, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.4, action: 0.85, family: 0.7, chill: 0.1, novelty: 0.85, social: 0.9 },
    bookable: true, minAge: 14,
  },
  minigolf: {
    category: 'activity', kind: 'Minigolf', emoji: '⛳', priceLevel: 1,
    typicalDurationMin: 70, indoorOutdoor: 'outdoor', ...OUTDOOR,
    bestSeasons: ['spring', 'summer'],
    scores: { romantic: 0.6, action: 0.5, family: 0.95, chill: 0.7, novelty: 0.5, social: 0.9 },
  },
  karaoke: {
    category: 'activity', kind: 'Karaoke', emoji: '🎤', priceLevel: 2,
    typicalDurationMin: 90, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.4, action: 0.7, family: 0.4, chill: 0.3, novelty: 0.8, social: 0.95 },
    minAge: 18,
  },
  zoo: {
    category: 'activity', kind: 'Zoo', emoji: '🦁', priceLevel: 2,
    typicalDurationMin: 150, indoorOutdoor: 'outdoor', rainSuitability: 0.25,
    heatSuitability: 0.7, coldSuitability: 0.35, bestSeasons: ['spring', 'summer'],
    scores: { romantic: 0.4, action: 0.3, family: 1, chill: 0.6, novelty: 0.6, social: 0.6 },
  },
  aquarium: {
    category: 'activity', kind: 'Aquarium', emoji: '🐠', priceLevel: 2,
    typicalDurationMin: 100, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.6, action: 0.2, family: 0.95, chill: 0.7, novelty: 0.7, social: 0.5 },
  },
  themepark: {
    category: 'activity', kind: 'Freizeitpark', emoji: '🎢', priceLevel: 3,
    typicalDurationMin: 300, indoorOutdoor: 'outdoor', ...OUTDOOR,
    bestSeasons: ['spring', 'summer'],
    scores: { romantic: 0.4, action: 0.95, family: 0.95, chill: 0.1, novelty: 0.8, social: 0.9 },
  },
  dance: {
    category: 'activity', kind: 'Tanzen', emoji: '💃', priceLevel: 1,
    typicalDurationMin: 90, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.7, action: 0.7, family: 0.3, chill: 0.3, novelty: 0.7, social: 0.9 },
  },
  casino: {
    category: 'activity', kind: 'Spielbank', emoji: '🎰', priceLevel: 3,
    typicalDurationMin: 120, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.3, action: 0.6, family: 0, chill: 0.2, novelty: 0.6, social: 0.6 },
    minAge: 18,
  },

  // ----------------------------------------------------------------- Gaming
  arcade: {
    category: 'gaming', kind: 'Arcade', emoji: '🎮', priceLevel: 1,
    typicalDurationMin: 75, indoorOutdoor: 'indoor', ...INDOOR,
    bestSeasons: ['autumn', 'winter'],
    scores: { romantic: 0.3, action: 0.75, family: 0.8, chill: 0.3, novelty: 0.7, social: 0.9 },
  },
  vr: {
    category: 'gaming', kind: 'VR-Arena', emoji: '🕶️', priceLevel: 2,
    typicalDurationMin: 70, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.2, action: 0.95, family: 0.6, chill: 0.1, novelty: 0.95, social: 0.85 },
    bookable: true, minAge: 12,
  },

  // ------------------------------------------------------------------ Kino
  cinema: {
    category: 'cinema', kind: 'Kino', emoji: '🎬', priceLevel: 1,
    typicalDurationMin: 135, indoorOutdoor: 'indoor', ...INDOOR,
    bestSeasons: ['autumn', 'winter'],
    scores: { romantic: 0.75, action: 0.2, family: 0.85, chill: 0.8, novelty: 0.4, social: 0.6 },
    bookable: true,
  },

  // ---------------------------------------------------------------- Kultur
  museum: {
    category: 'culture', kind: 'Museum', emoji: '🏛️', priceLevel: 1,
    typicalDurationMin: 95, indoorOutdoor: 'indoor', ...INDOOR,
    bestSeasons: ['autumn', 'winter'],
    scores: { romantic: 0.6, action: 0.1, family: 0.7, chill: 0.8, novelty: 0.8, social: 0.4 },
  },
  gallery: {
    category: 'culture', kind: 'Galerie', emoji: '🖼️', priceLevel: 0,
    typicalDurationMin: 60, indoorOutdoor: 'indoor', ...INDOOR,
    bestSeasons: ['autumn', 'winter'],
    scores: { romantic: 0.7, action: 0.05, family: 0.4, chill: 0.85, novelty: 0.8, social: 0.4 },
  },
  theatre: {
    category: 'culture', kind: 'Bühne', emoji: '🎭', priceLevel: 2,
    typicalDurationMin: 120, indoorOutdoor: 'indoor', ...INDOOR,
    bestSeasons: ['autumn', 'winter'],
    scores: { romantic: 0.85, action: 0.1, family: 0.4, chill: 0.6, novelty: 0.8, social: 0.5 },
    bookable: true,
  },
  attraction: {
    category: 'culture', kind: 'Sehenswürdigkeit', emoji: '📸', priceLevel: 0,
    typicalDurationMin: 50, indoorOutdoor: 'mixed', ...MIXED, bestSeasons: [],
    scores: { romantic: 0.7, action: 0.2, family: 0.7, chill: 0.7, novelty: 0.75, social: 0.6 },
  },

  // ----------------------------------------------------------------- Natur
  park: {
    category: 'nature', kind: 'Park', emoji: '🌳', priceLevel: 0,
    typicalDurationMin: 60, indoorOutdoor: 'outdoor', rainSuitability: 0.1,
    heatSuitability: 0.8, coldSuitability: 0.3,
    bestSeasons: ['spring', 'summer', 'autumn'],
    scores: { romantic: 0.8, action: 0.2, family: 0.9, chill: 0.95, novelty: 0.3, social: 0.7 },
  },
  garden: {
    category: 'nature', kind: 'Garten', emoji: '🌷', priceLevel: 0,
    typicalDurationMin: 60, indoorOutdoor: 'outdoor', ...OUTDOOR,
    bestSeasons: ['spring', 'summer'],
    scores: { romantic: 0.85, action: 0.1, family: 0.8, chill: 0.95, novelty: 0.5, social: 0.5 },
  },
  viewpoint: {
    category: 'nature', kind: 'Aussichtspunkt', emoji: '🌅', priceLevel: 0,
    typicalDurationMin: 45, indoorOutdoor: 'outdoor', rainSuitability: 0.05,
    heatSuitability: 0.75, coldSuitability: 0.4,
    bestSeasons: ['spring', 'summer', 'autumn'],
    scores: { romantic: 0.95, action: 0.2, family: 0.6, chill: 0.9, novelty: 0.6, social: 0.5 },
  },
  beach: {
    category: 'nature', kind: 'Strand', emoji: '🏖️', priceLevel: 0,
    typicalDurationMin: 120, indoorOutdoor: 'outdoor', rainSuitability: 0.05,
    heatSuitability: 1, coldSuitability: 0.05, bestSeasons: ['summer'],
    scores: { romantic: 0.85, action: 0.4, family: 0.9, chill: 0.95, novelty: 0.5, social: 0.8 },
  },
  nature_reserve: {
    category: 'nature', kind: 'Naturgebiet', emoji: '🌲', priceLevel: 0,
    typicalDurationMin: 90, indoorOutdoor: 'outdoor', ...OUTDOOR,
    bestSeasons: ['spring', 'summer', 'autumn'],
    scores: { romantic: 0.7, action: 0.4, family: 0.7, chill: 0.9, novelty: 0.6, social: 0.4 },
  },

  // ----------------------------------------------------------------- Sport
  climbing: {
    category: 'sport', kind: 'Kletterhalle', emoji: '🧗', priceLevel: 1,
    typicalDurationMin: 100, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.3, action: 0.9, family: 0.6, chill: 0.2, novelty: 0.7, social: 0.8 },
  },
  pool: {
    category: 'sport', kind: 'Schwimmbad', emoji: '🏊', priceLevel: 1,
    typicalDurationMin: 110, indoorOutdoor: 'mixed', rainSuitability: 0.6,
    heatSuitability: 1, coldSuitability: 0.5, bestSeasons: ['summer'],
    scores: { romantic: 0.3, action: 0.6, family: 0.95, chill: 0.7, novelty: 0.3, social: 0.8 },
  },
  waterpark: {
    category: 'sport', kind: 'Erlebnisbad', emoji: '🌊', priceLevel: 2,
    typicalDurationMin: 180, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.3, action: 0.8, family: 1, chill: 0.5, novelty: 0.6, social: 0.85 },
  },
  icerink: {
    category: 'sport', kind: 'Eisbahn', emoji: '⛸️', priceLevel: 1,
    typicalDurationMin: 90, indoorOutdoor: 'mixed', rainSuitability: 0.5,
    heatSuitability: 0.2, coldSuitability: 1, bestSeasons: ['winter'],
    scores: { romantic: 0.8, action: 0.7, family: 0.9, chill: 0.4, novelty: 0.6, social: 0.9 },
  },
  sportscentre: {
    category: 'sport', kind: 'Sportzentrum', emoji: '🏟️', priceLevel: 1,
    typicalDurationMin: 90, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.2, action: 0.85, family: 0.7, chill: 0.2, novelty: 0.5, social: 0.8 },
  },
  bike: {
    category: 'sport', kind: 'Radtour', emoji: '🚲', priceLevel: 0,
    typicalDurationMin: 90, indoorOutdoor: 'outdoor', ...OUTDOOR,
    bestSeasons: ['spring', 'summer', 'autumn'],
    scores: { romantic: 0.6, action: 0.7, family: 0.7, chill: 0.7, novelty: 0.5, social: 0.7 },
  },

  // -------------------------------------------------------------- Wellness
  spa: {
    category: 'wellness', kind: 'Therme', emoji: '♨️', priceLevel: 2,
    typicalDurationMin: 150, indoorOutdoor: 'indoor', rainSuitability: 1,
    heatSuitability: 0.5, coldSuitability: 1, bestSeasons: ['autumn', 'winter'],
    scores: { romantic: 0.85, action: 0.05, family: 0.3, chill: 1, novelty: 0.5, social: 0.4 },
    bookable: true, minAge: 16,
  },

  // -------------------------------------------------------------- Bummeln
  market: {
    category: 'shopping', kind: 'Markt', emoji: '🧺', priceLevel: 0,
    typicalDurationMin: 60, indoorOutdoor: 'outdoor', rainSuitability: 0.3,
    heatSuitability: 0.7, coldSuitability: 0.4,
    bestSeasons: ['spring', 'summer', 'autumn'],
    scores: { romantic: 0.5, action: 0.2, family: 0.8, chill: 0.8, novelty: 0.7, social: 0.7 },
  },
  mall: {
    category: 'shopping', kind: 'Einkaufszentrum', emoji: '🛍️', priceLevel: 1,
    typicalDurationMin: 90, indoorOutdoor: 'indoor', ...INDOOR, bestSeasons: [],
    scores: { romantic: 0.2, action: 0.2, family: 0.8, chill: 0.6, novelty: 0.3, social: 0.7 },
  },

  // ----------------------------------------------------------------- Event
  event: {
    category: 'event', kind: 'Event', emoji: '🎪', priceLevel: 2,
    typicalDurationMin: 120, indoorOutdoor: 'mixed', ...MIXED, bestSeasons: [],
    scores: { romantic: 0.5, action: 0.6, family: 0.5, chill: 0.5, novelty: 1, social: 0.9 },
    bookable: true,
  },
} satisfies Record<string, ActivityProfile>;

export const CATEGORY_LABEL: Record<Category, string> = {
  food: 'Essen',
  cafe: 'Café',
  bar: 'Bar',
  activity: 'Aktivität',
  cinema: 'Kino',
  culture: 'Kultur',
  nature: 'Natur',
  sport: 'Sport',
  gaming: 'Gaming',
  wellness: 'Wellness',
  shopping: 'Bummeln',
  event: 'Event',
};

export const CATEGORY_EMOJI: Record<Category, string> = {
  food: '🍽️',
  cafe: '☕',
  bar: '🍹',
  activity: '🎳',
  cinema: '🎬',
  culture: '🏛️',
  nature: '🌳',
  sport: '🏃',
  gaming: '🎮',
  wellness: '♨️',
  shopping: '🧺',
  event: '🎪',
};

/** €-Darstellung eines geschätzten Preisniveaus. */
export const PRICE_LEVEL_LABEL: Record<PriceLevel, string> = {
  0: 'kostenlos',
  1: '€',
  2: '€€',
  3: '€€€',
};
