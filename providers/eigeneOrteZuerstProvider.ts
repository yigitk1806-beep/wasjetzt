import { GebietNichtAbgedecktError } from '@/db/postgresPlaceProvider';
import type { PlaceProvider, PlaceQuery } from './types';
import type { Coordinates, Place } from '@/types/domain';

/**
 * Fragt die eigene Ortsdatenbank, und nur wenn die für diese Gegend nichts
 * hat, OpenStreetMap.
 *
 * Die Reihenfolge ist der ganze Punkt. Bisher hing jeder Plan an den
 * öffentlichen Overpass-Servern; die sind gespendete Infrastruktur und
 * tragen die Last nicht. Am 04.11.2026 waren alle drei seit 15 Tagen
 * ununterbrochen im Zeitlimit, und die App konnte in kalten Gegenden keinen
 * einzigen Plan bauen. Für importierte Gebiete kommt jetzt keine Anfrage
 * mehr ins fremde Netz.
 *
 * Für alles andere bleibt Overpass unverändert der Weg - mit Cache,
 * Notfallspeicher und ehrlicher Absage bei Ausfall. Es wird keine Funktion
 * ersetzt, es kommt eine schnellere Quelle davor.
 */
export class EigeneOrteZuerstProvider implements PlaceProvider {
  readonly id: string;
  readonly isMock = false;

  constructor(
    private readonly eigene: PlaceProvider,
    private readonly fremde: PlaceProvider,
  ) {
    this.id = `${eigene.id}+${fremde.id}`;
  }

  async search(query: PlaceQuery): Promise<Place[]> {
    try {
      const orte = await this.eigene.search(query);
      // Ein leeres Ergebnis aus einem abgedeckten Gebiet ist eine Aussage:
      // Hier gibt es nichts Passendes. Das ist kein Ausfall, und es wird
      // deshalb auch nicht bei Overpass nachgefragt - das würde fremde
      // Server belasten, um dieselbe Antwort zu bekommen.
      return orte;
    } catch (error) {
      if (error instanceof Error && error.name === 'GebietNichtAbgedecktError') {
        // Gegend nicht importiert - der normale Fall außerhalb Berlins.
        // Kein Grund für eine Warnung, das ist der vorgesehene Weg.
        return this.fremde.search(query);
      }
      // Datenbank kaputt oder nicht erreichbar. Das darf die Suche nicht
      // beenden: Overpass ist langsamer, aber es ist eine Antwort.
      console.warn(
        `[orte] eigene Datenbank nicht nutzbar (${error instanceof Error ? error.name : 'unbekannt'}), weiche auf ${this.fremde.id} aus`,
      );
      return this.fremde.search(query);
    }
  }

  async getById(id: string): Promise<Place | null> {
    try {
      const eigen = await this.eigene.getById?.(id);
      if (eigen) return eigen;
    } catch {
      // Still: Gleich danach wird es ohnehin bei der fremden Quelle probiert.
    }
    return (await this.fremde.getById?.(id)) ?? null;
  }

  /**
   * Vorladen betrifft nur die fremde Quelle. Die eigene Datenbank braucht
   * es nicht - sie antwortet ohne Netz, da ist nichts vorzuwärmen.
   */
  async prefetch(center: Coordinates, theme?: 'places' | 'sights'): Promise<void> {
    await this.fremde.prefetch?.(center, theme);
  }
}

export { GebietNichtAbgedecktError };
