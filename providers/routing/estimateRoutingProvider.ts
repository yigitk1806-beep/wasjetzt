import { estimateTravelMinutes, haversineMeters } from '@/lib/geo';
import type { RouteQuery, RoutingProvider } from '@/providers/types';
import type { TravelLeg } from '@/types/domain';

/**
 * Schätzt Reisezeiten aus Luftlinie plus Umwegfaktor.
 * Kein echtes Routing – jede gelieferte Strecke ist als `estimated: true`
 * markiert, damit die UI das nicht als exakte Fahrzeit ausgibt.
 * Ein echter Routing-Provider (OSRM, Mapbox, Google) kann hier andocken.
 */
export class EstimateRoutingProvider implements RoutingProvider {
  readonly id = 'estimate';

  async route(query: RouteQuery): Promise<TravelLeg> {
    const distanceMeters = Math.round(haversineMeters(query.from, query.to));
    return {
      mode: query.mode,
      distanceMeters,
      durationMin: estimateTravelMinutes(distanceMeters, query.mode),
      estimated: true,
    };
  }

  async routeMany(queries: RouteQuery[]): Promise<TravelLeg[]> {
    return Promise.all(queries.map((q) => this.route(q)));
  }
}
