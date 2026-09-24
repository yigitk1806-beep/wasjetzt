import type { RouteQuery, RoutingProvider } from '@/providers/types';
import type { TravelLeg } from '@/types/domain';

/**
 * Versucht echtes Routing und fällt pro Weg einzeln auf die geometrische
 * Schätzung zurück – etwa beim ÖPNV, für den es kein offenes Profil gibt,
 * oder wenn der Routing-Dienst gerade nicht antwortet.
 *
 * Der Unterschied bleibt für den Nutzer sichtbar: Geschätzte Wege tragen
 * `estimated: true` und werden in der UI mit „ca." ausgewiesen.
 */
export class FallbackRoutingProvider implements RoutingProvider {
  readonly id: string;

  constructor(
    private readonly primary: RoutingProvider,
    private readonly fallback: RoutingProvider,
  ) {
    this.id = `${primary.id}+${fallback.id}`;
  }

  async route(query: RouteQuery): Promise<TravelLeg> {
    try {
      return await this.primary.route(query);
    } catch (error) {
      // Für ÖPNV ist das der Normalfall und kein Problem; alles andere
      // soll im Log sichtbar sein, damit stille Verschlechterung auffällt.
      if (query.mode !== 'transit') {
        console.warn(`[routing] ${this.primary.id} fehlgeschlagen (${query.mode})`, error);
      }
      return this.fallback.route(query);
    }
  }

  async routeMany(queries: RouteQuery[]): Promise<TravelLeg[]> {
    return Promise.all(queries.map((q) => this.route(q)));
  }

  /** Reicht den Erreichbarkeitstest an die echte Quelle durch. */
  async probe(): Promise<unknown> {
    const probe = (this.primary as { probe?: () => Promise<unknown> }).probe;
    return probe ? probe.call(this.primary) : 'kein Test verfuegbar';
  }
}
