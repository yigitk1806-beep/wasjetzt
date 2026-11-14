import type { RouteQuery, RoutingProvider } from '@/providers/types';
import type { TravelLeg } from '@/types/domain';
import { haversineMeters } from '@/lib/geo';

/**
 * Bis zu dieser Luftlinie wird ein ÖPNV-Weg gelaufen. 1,2 km sind zu Fuß
 * rund 15 Minuten – mit Weg zur Haltestelle und Warten ist die Bahn auf
 * solchen Strecken kaum schneller.
 */
export const OEPNV_ZU_FUSS_BIS_M = 1200;

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

  // Ausgeschriebene Felder statt `private readonly` im Konstruktor: So
  // laedt Node die Datei auch ohne Uebersetzungsschritt, und der Test in
  // infra/tests/oepnv-fussweg.mts kann sie direkt pruefen.
  private readonly primary: RoutingProvider;
  private readonly fallback: RoutingProvider;
  /** Echte Bus- und Bahnverbindungen, wo es sie gibt (transport.rest). */
  private readonly oepnv?: RoutingProvider;

  constructor(primary: RoutingProvider, fallback: RoutingProvider, oepnv?: RoutingProvider) {
    this.primary = primary;
    this.fallback = fallback;
    this.oepnv = oepnv;
    this.id = `${primary.id}+${fallback.id}`;
  }

  async route(query: RouteQuery): Promise<TravelLeg> {
    // ÖPNV über kurze Strecken heißt in Wirklichkeit: zu Fuß. Niemand
    // nimmt für 600 m die U-Bahn. Für den ÖPNV gibt es kein offenes
    // Routing-Profil, also war jeder solche Weg bisher eine gestrichelte
    // Luftlinie – auch dort, wo man ihn in sieben Minuten läuft. Jetzt wird
    // er als echter Fußweg berechnet und als solcher ausgewiesen (`mode:
    // 'walk'`, Symbol 🚶), mit Straßenführung auf der Karte. Längere
    // ÖPNV-Wege bleiben ehrlich geschätzt: Einen Fußweg als Bahnfahrt
    // auszugeben wäre erfunden.
    if (query.mode === 'transit' && haversineMeters(query.from, query.to) <= OEPNV_ZU_FUSS_BIS_M) {
      try {
        return await this.primary.route({ ...query, mode: 'walk' });
      } catch {
        // Fußweg nicht berechenbar – dann wie bisher geschätzt.
      }
    }
    // Längere ÖPNV-Wege: echte Verbindung mit Linie und Abfahrt. Antwortet
    // der Dienst nicht oder liegt der Weg außerhalb seines Gebiets, bleibt
    // es bei der ehrlichen Schätzung darunter.
    if (query.mode === 'transit' && this.oepnv) {
      try {
        return await this.oepnv.route(query);
      } catch (error) {
        console.warn(`[routing] ${this.oepnv.id} nicht nutzbar`, error instanceof Error ? error.message : error);
      }
    }
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
