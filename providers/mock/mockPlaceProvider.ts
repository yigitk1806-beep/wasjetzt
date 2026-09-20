import { hashString, seededRandom } from '@/lib/id';
import { haversineMeters, offsetCoordinates } from '@/lib/geo';
import { profileFor } from '@/providers/activityProfiles';
import type { Place } from '@/types/domain';
import type { PlaceProvider, PlaceQuery } from '@/providers/types';
import { MOCK_TEMPLATES, type MockTemplate } from './templates';

/** Kantenlänge einer Generierungszelle in Grad (~4,4 km bei 50° Breite). */
const CELL_DEGREES = 0.04;

/**
 * Ersatzquelle für den Fall, dass keine echte Ortsdatenbank erreichbar ist.
 *
 * Alle Orte sind frei erfunden und tragen `source: 'mock'`, damit die UI sie
 * eindeutig als Demo kennzeichnen kann. Es werden bewusst keine Eurobeträge
 * erfunden – nur ein Preisniveau, genau wie bei echten Daten ohne Preisangabe.
 */
export class MockPlaceProvider implements PlaceProvider {
  readonly id = 'mock-places';
  readonly isMock = true;

  private cache = new Map<string, Place[]>();

  async search(query: PlaceQuery): Promise<Place[]> {
    const all = this.generateAround(query.center.lat, query.center.lon);
    const filtered = all.filter((place) => {
      if (query.categories?.length && !query.categories.includes(place.category)) {
        return false;
      }
      return haversineMeters(query.center, place.location) <= query.radiusMeters;
    });
    filtered.sort(
      (a, b) =>
        haversineMeters(query.center, a.location) - haversineMeters(query.center, b.location),
    );
    return query.limit ? filtered.slice(0, query.limit) : filtered;
  }

  async getById(id: string): Promise<Place | null> {
    for (const places of this.cache.values()) {
      const hit = places.find((p) => p.id === id);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Generiert Orte in einem Raster um die Koordinate. Das Raster sorgt dafür,
   * dass ein Nutzer, der sich ein Stück bewegt, dieselben Orte wiedersieht.
   */
  private generateAround(lat: number, lon: number): Place[] {
    const cellLat = Math.round(lat / CELL_DEGREES) * CELL_DEGREES;
    const cellLon = Math.round(lon / CELL_DEGREES) * CELL_DEGREES;
    const key = `${cellLat.toFixed(3)}:${cellLon.toFixed(3)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const places: Place[] = [];
    // Nachbarzellen mitgenerieren, damit es an Zellgrenzen keine Lücke gibt.
    for (let dLat = -1; dLat <= 1; dLat += 1) {
      for (let dLon = -1; dLon <= 1; dLon += 1) {
        places.push(
          ...this.generateCell(
            cellLat + dLat * CELL_DEGREES,
            cellLon + dLon * CELL_DEGREES,
          ),
        );
      }
    }
    this.cache.set(key, places);
    return places;
  }

  private generateCell(cellLat: number, cellLon: number): Place[] {
    const seed = hashString(`${cellLat.toFixed(3)}|${cellLon.toFixed(3)}`);
    const rnd = seededRandom(seed);
    const center = { lat: cellLat, lon: cellLon };
    const out: Place[] = [];

    for (const template of MOCK_TEMPLATES) {
      const count = Math.max(1, Math.round(template.density * (0.6 + rnd() * 0.8)));
      for (let i = 0; i < count; i += 1) {
        out.push(this.instantiate(template, center, rnd, i, seed));
      }
    }
    return out;
  }

  private instantiate(
    template: MockTemplate,
    center: { lat: number; lon: number },
    rnd: () => number,
    index: number,
    seed: number,
  ): Place {
    const profile = profileFor(template.profile);

    // Orte füllen die ganze Zelle, sonst entstehen große leere Flächen
    // und der nächste Ort ist immer kilometerweit weg.
    const halfNorth = CELL_DEGREES * 0.5 * 111_320;
    const halfEast = halfNorth * (Math.cos((center.lat * Math.PI) / 180) || 1);

    const spreadOut = (value: number) =>
      template.spreadMeters > 3000
        ? Math.sign(value) * Math.max(Math.abs(value), 0.55)
        : value;

    const location = offsetCoordinates(
      center,
      spreadOut(rnd() * 2 - 1) * halfEast,
      spreadOut(rnd() * 2 - 1) * halfNorth,
    );

    const baseName = template.names[index % template.names.length];
    const suffix =
      index >= template.names.length
        ? ` ${Math.floor(index / template.names.length) + 1}`
        : '';

    // Rabatte gibt es nur dort, wo überhaupt etwas zu zahlen ist.
    const hasDeal = profile.priceLevel >= 1 && rnd() < 0.14;
    const discount = 15 + Math.round(rnd() * 20);

    return {
      id: `mock_${seed.toString(36)}_${template.profile}_${index}`,
      name: `${baseName}${suffix}`,
      category: profile.category,
      kind: profile.kind,
      emoji: profile.emoji,
      location: { ...location },
      // Auch hier keine erfundenen Beträge – nur ein Niveau.
      price: { level: profile.priceLevel, levelEstimated: true },
      typicalDurationMin: profile.typicalDurationMin,
      openingHours: template.openingHours,
      indoorOutdoor: profile.indoorOutdoor,
      rainSuitability: profile.rainSuitability,
      heatSuitability: profile.heatSuitability,
      coldSuitability: profile.coldSuitability,
      bestSeasons: profile.bestSeasons,
      scores: { ...profile.scores },
      // Bewusst keine Bewertungen: erfundene Ratings wären irreführend.
      source: 'mock',
      minAge: profile.minAge,
      bookable: profile.bookable,
      deal: hasDeal
        ? { label: `Heute ${discount} % günstiger`, discountPercent: discount }
        : undefined,
    };
  }
}
