import type { Coordinates, Place } from '@/types/domain';
import type { PlaceProvider, PlaceQuery } from './types';

/**
 * Nutzt die echte Quelle und weicht nur dann auf die Ersatzquelle aus,
 * wenn die echte gar nicht erreichbar ist.
 *
 * Wichtig: Ein *leeres* Ergebnis der echten Quelle wird nicht ersetzt.
 * "In dieser Gegend ist nichts erfasst" ist eine korrekte Auskunft –
 * sie durch Demo-Orte zu überdecken wäre eine Lüge. Nur ein technischer
 * Ausfall rechtfertigt den Fallback, und dann kennzeichnet die UI die
 * Ergebnisse über `place.source` als Demo-Daten.
 */
export class FallbackPlaceProvider implements PlaceProvider {
  readonly id: string;
  readonly isMock = false;

  constructor(
    private readonly primary: PlaceProvider,
    private readonly fallback: PlaceProvider,
  ) {
    this.id = `${primary.id}+${fallback.id}`;
  }

  async search(query: PlaceQuery): Promise<Place[]> {
    try {
      return await this.primary.search(query);
    } catch (error) {
      console.warn(
        `[places] ${this.primary.id} nicht verfügbar, nutze ${this.fallback.id}`,
        error,
      );
      return this.fallback.search(query);
    }
  }

  async getById(id: string): Promise<Place | null> {
    const provider = id.startsWith('mock') ? this.fallback : this.primary;
    return provider.getById?.(id) ?? null;
  }

  async prefetch(center: Coordinates): Promise<void> {
    await this.primary.prefetch?.(center);
  }
}
