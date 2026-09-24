import type { GeocodeResult, GeocodingProvider } from '@/providers/types';
import type { Coordinates } from '@/types/domain';

/** Enthält die Eingabe eine Ziffer oder ein Komma, ist eine Adresse gemeint. */
const NACH_ADRESSE = /\d|,/;

/**
 * Eine Suche, zwei Quellen.
 *
 * „Berlin" ist eine Ortssuche – dort ist die Einwohnerzahl das bessere
 * Ranking. „Müllerstraße 120 Berlin" ist eine Adresssuche – dort zählt die
 * Hausnummer. Welche Quelle gefragt wird, entscheidet die Eingabe; findet die
 * eine nichts, springt die andere ein. Für die Oberfläche bleibt es eine
 * einzige Suche.
 */
export class CompositeGeocodingProvider implements GeocodingProvider {
  readonly id = 'composite-geocoding';

  constructor(
    private readonly orte: GeocodingProvider,
    private readonly adressen: GeocodingProvider,
  ) {}

  async search(query: string, locale = 'de', near?: Coordinates): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (q.length < 2) return [];

    if (NACH_ADRESSE.test(q)) {
      const treffer = await this.adressen.search(q, locale, near);
      return treffer.length ? treffer : this.orte.search(q, locale, near);
    }

    const orte = await this.orte.search(q, locale, near);
    if (orte.length > 0) return orte;
    return this.adressen.search(q, locale, near);
  }

  /** Nur die Adressquelle kennt echte Rückwärtssuche. */
  async reverse(at: Coordinates, locale = 'de'): Promise<GeocodeResult | null> {
    return (await this.adressen.reverse(at, locale)) ?? this.orte.reverse(at, locale);
  }
}
