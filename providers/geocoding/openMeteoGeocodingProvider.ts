import type { GeocodeResult, GeocodingProvider } from '@/providers/types';
import type { Coordinates } from '@/types/domain';

type GeoResponse = {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    admin1?: string;
  }>;
};

/**
 * Ortssuche über die Open-Meteo Geocoding-API (kein Key nötig).
 * Liefert echte Ortsnamen und Koordinaten – keine erfundenen Orte.
 */
export class OpenMeteoGeocodingProvider implements GeocodingProvider {
  readonly id = 'open-meteo-geocoding';

  async search(query: string, locale = 'de'): Promise<GeocodeResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    try {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.searchParams.set('name', trimmed);
      url.searchParams.set('count', '6');
      url.searchParams.set('language', locale.slice(0, 2));
      url.searchParams.set('format', 'json');

      const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (!res.ok) return [];
      const json = (await res.json()) as GeoResponse;
      return (json.results ?? []).map((r) => ({
        label: r.name,
        location: { lat: r.latitude, lon: r.longitude },
        country: r.country,
        admin: r.admin1,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Open-Meteo bietet kein echtes Reverse-Geocoding. Statt einen Ortsnamen
   * zu erfinden, liefern wir null – die UI zeigt dann "Dein Standort".
   */
  async reverse(_at: Coordinates): Promise<GeocodeResult | null> {
    return null;
  }
}
