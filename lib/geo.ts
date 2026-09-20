import type { Coordinates, Mobility } from '@/types/domain';

const EARTH_RADIUS_M = 6371000;

export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Durchschnittsgeschwindigkeiten inkl. Umwege, in km/h. */
const SPEED_KMH: Record<Mobility, number> = {
  walk: 4.6,
  bike: 14,
  transit: 18,
  car: 27,
};

/** Fixer Zusatzaufwand pro Weg (Parken, Warten auf Bahn …) in Minuten. */
const OVERHEAD_MIN: Record<Mobility, number> = {
  walk: 0,
  bike: 2,
  transit: 6,
  car: 4,
};

/**
 * Grobe Reisezeit ohne echtes Routing. Der Umwegfaktor bildet ab,
 * dass Luftlinie nie der tatsächlichen Strecke entspricht.
 */
export function estimateTravelMinutes(
  distanceMeters: number,
  mode: Mobility,
): number {
  if (distanceMeters <= 0) return 0;
  const detourFactor = mode === 'walk' ? 1.25 : 1.35;
  const km = (distanceMeters / 1000) * detourFactor;
  const minutes = (km / SPEED_KMH[mode]) * 60 + OVERHEAD_MIN[mode];
  return Math.max(1, Math.round(minutes));
}

/** Sinnvoller Suchradius je Mobilität – begrenzt, damit nichts Absurdes vorgeschlagen wird. */
export function searchRadiusMeters(mode: Mobility, availableMinutes: number): number {
  const base: Record<Mobility, number> = {
    walk: 1800,
    bike: 5000,
    transit: 9000,
    car: 16000,
  };
  // Bei sehr kurzen Zeitfenstern schrumpft der Radius mit.
  const timeFactor = Math.min(1, Math.max(0.35, availableMinutes / 240));
  return Math.round(base[mode] * timeFactor);
}

export function formatDistance(meters: number, locale = 'de'): string {
  if (meters < 950) return `${Math.round(meters / 50) * 50} m`;
  const km = meters / 1000;
  return `${km.toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
}

/** Bounding-Box um einen Punkt, in Grad. */
export function offsetCoordinates(
  origin: Coordinates,
  eastMeters: number,
  northMeters: number,
): Coordinates {
  const dLat = northMeters / 111_320;
  const dLon = eastMeters / (111_320 * Math.cos((origin.lat * Math.PI) / 180) || 1);
  return { lat: origin.lat + dLat, lon: origin.lon + dLon };
}
