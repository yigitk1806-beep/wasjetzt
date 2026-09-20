import type { Category, Place, Season, WeatherSlice } from '@/types/domain';

export type WeatherMode = 'wet' | 'cold' | 'hot' | 'pleasant' | 'neutral';

export function weatherModeOf(slice: WeatherSlice | null): WeatherMode {
  if (!slice || slice.condition === 'unknown') return 'neutral';
  const wet =
    slice.condition === 'rain' ||
    slice.condition === 'thunderstorm' ||
    slice.condition === 'snow' ||
    slice.precipitationProbability >= 55 ||
    slice.precipitationMm >= 0.4;
  if (wet) return 'wet';
  if (slice.temperatureC <= 4) return 'cold';
  if (slice.temperatureC >= 28) return 'hot';
  if (slice.temperatureC >= 17 && slice.temperatureC <= 27) return 'pleasant';
  return 'neutral';
}

/**
 * 0..1 – wie gut passt der Ort zum Wetter zum Zeitpunkt des Besuchs.
 * Bei unbekanntem Wetter bewusst neutral (0.6), damit die Planung
 * nicht auf geratenen Daten basiert.
 */
export function weatherFit(place: Place, slice: WeatherSlice | null): number {
  const mode = weatherModeOf(slice);
  switch (mode) {
    case 'wet':
      return place.rainSuitability;
    case 'cold':
      return place.coldSuitability;
    case 'hot':
      return place.heatSuitability;
    case 'pleasant':
      return place.indoorOutdoor === 'outdoor'
        ? 1
        : place.indoorOutdoor === 'mixed'
          ? 0.85
          : 0.65;
    default:
      return 0.6;
  }
}

/** Harter Ausschluss: Draußen bei Sturm, Gewitter oder starkem Regen. */
export function isWeatherBlocked(place: Place, slice: WeatherSlice | null): boolean {
  if (!slice || slice.condition === 'unknown') return false;
  if (place.indoorOutdoor === 'indoor') return false;
  const severe =
    slice.condition === 'thunderstorm' ||
    slice.precipitationMm >= 1.5 ||
    slice.windKmh >= 45;
  if (severe && place.rainSuitability < 0.5) return true;
  const soaking = slice.precipitationProbability >= 70 && place.rainSuitability < 0.3;
  return soaking;
}

/** 0..1 – passt der Ort zur Jahreszeit? */
export function seasonFit(place: Place, season: Season): number {
  if (place.bestSeasons.length === 0) return 0.7;
  return place.bestSeasons.includes(season) ? 1 : 0.35;
}

/** Kategorien, die eine Jahreszeit spürbar anhebt. */
const SEASON_BOOST: Record<Season, Category[]> = {
  spring: ['nature', 'cafe', 'sport'],
  summer: ['nature', 'sport', 'bar', 'event'],
  autumn: ['cafe', 'culture', 'food', 'cinema'],
  winter: ['cinema', 'gaming', 'culture', 'wellness', 'activity'],
};

export function seasonCategoryBoost(category: Category, season: Season): number {
  return SEASON_BOOST[season].includes(category) ? 0.12 : 0;
}

export function weatherEmoji(slice: WeatherSlice | null): string {
  if (!slice) return '🌡️';
  switch (slice.condition) {
    case 'clear':
      return slice.isDay ? '☀️' : '🌙';
    case 'cloudy':
      return '🌤️';
    case 'rain':
      return '🌧️';
    case 'snow':
      return '❄️';
    case 'thunderstorm':
      return '⛈️';
    case 'fog':
      return '🌫️';
    default:
      return '🌡️';
  }
}
