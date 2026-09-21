import type { GeocodeResult, GeocodingProvider } from '@/providers/types';
import type { Coordinates } from '@/types/domain';

type GeoResponse = {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    country_code?: string;
    admin1?: string;
    population?: number;
  }>;
};

/** Länder, die bei einer Suche auf Deutsch zuerst kommen. */
const BEVORZUGT: Record<string, string[]> = {
  de: ['DE', 'AT', 'CH'],
};

/**
 * Treffer, die im Vergleich zum besten winzig sind, fliegen raus.
 * „Berlin" liefert sonst neben der Hauptstadt fünf US-Kleinstädte mit je
 * rund 10.000 Einwohnern – bei 2 % Schwelle bleibt nur Berlin übrig.
 * Echte Mehrdeutigkeit bleibt erhalten: Frankfurt (Oder) hat rund 8 % von
 * Frankfurt am Main und wird weiter angezeigt.
 */
const MINDESTANTEIL = 0.02;
const MAX_TREFFER = 5;

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
      url.searchParams.set('count', '12');
      url.searchParams.set('language', locale.slice(0, 2));
      url.searchParams.set('format', 'json');

      const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (!res.ok) return [];
      const json = (await res.json()) as GeoResponse;

      return rank(json.results ?? [], BEVORZUGT[locale.slice(0, 2)] ?? []).map((r) => ({
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

type Roh = NonNullable<GeoResponse['results']>[number];

function rank(results: Roh[], bevorzugt: string[]): Roh[] {
  const vorne = (r: Roh) => (r.country_code && bevorzugt.includes(r.country_code) ? 1 : 0);

  const sortiert = [...results].sort(
    (a, b) => vorne(b) - vorne(a) || (b.population ?? 0) - (a.population ?? 0),
  );
  if (sortiert.length === 0) return sortiert;

  const schwelle = (sortiert[0].population ?? 0) * MINDESTANTEIL;
  return sortiert
    .filter((r, i) => i === 0 || (r.population ?? 0) >= schwelle)
    .slice(0, MAX_TREFFER);
}
