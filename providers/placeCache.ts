import type { Place } from '@/types/domain';

/**
 * Zwischenspeicher für Ortsabfragen.
 *
 * Als Schnittstelle, weil der richtige Speicher von der Umgebung abhängt:
 * Ein durchlaufender Server kommt mit dem Arbeitsspeicher aus, eine
 * serverlose Plattform braucht einen geteilten – sonst hat jede Instanz
 * ihren eigenen leeren Cache und die teure Abfrage passiert ständig neu.
 */
export interface PlaceCacheStore {
  readonly id: string;
  get(cellKey: string, maxAgeMs: number): Promise<Place[] | null>;
  set(cellKey: string, places: Place[]): Promise<void>;
}

/** Für lokale Entwicklung und als Rückfall, wenn keine Datenbank da ist. */
export class InMemoryPlaceCache implements PlaceCacheStore {
  readonly id = 'speicher';

  private entries = new Map<string, { at: number; places: Place[] }>();

  async get(cellKey: string, maxAgeMs: number): Promise<Place[] | null> {
    const entry = this.entries.get(cellKey);
    if (!entry) return null;
    if (Date.now() - entry.at > maxAgeMs) {
      this.entries.delete(cellKey);
      return null;
    }
    return entry.places;
  }

  async set(cellKey: string, places: Place[]): Promise<void> {
    this.entries.set(cellKey, { at: Date.now(), places });
    // Deckel gegen unbegrenztes Wachstum bei langlaufenden Prozessen.
    if (this.entries.size > 60) {
      const ältester = [...this.entries.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (ältester) this.entries.delete(ältester[0]);
    }
  }
}
