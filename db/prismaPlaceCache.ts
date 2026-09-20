import { PrismaClient } from '@prisma/client';
import type { PlaceCacheStore } from '@/providers/placeCache';
import type { Place } from '@/types/domain';

const globalForPrisma = globalThis as unknown as { __wasjetztPrisma?: PrismaClient };

function client(): PrismaClient {
  if (!globalForPrisma.__wasjetztPrisma) {
    globalForPrisma.__wasjetztPrisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return globalForPrisma.__wasjetztPrisma;
}

/**
 * Geteilter Ortscache in Postgres.
 *
 * Damit profitieren alle Instanzen von einer einmal bezahlten
 * OpenStreetMap-Abfrage – auch die, die das Vorladen nie gesehen haben.
 *
 * Fehler werden geschluckt: Ein kaputter Cache darf die Suche nicht
 * verhindern, er macht sie nur langsamer.
 */
export class PrismaPlaceCache implements PlaceCacheStore {
  readonly id = 'postgres';

  private lastCleanup = 0;

  async get(cellKey: string, maxAgeMs: number): Promise<Place[] | null> {
    try {
      const row = await client().placeCache.findUnique({ where: { cellKey } });
      if (!row) return null;
      if (Date.now() - row.fetchedAt.getTime() > maxAgeMs) return null;
      return row.payload as unknown as Place[];
    } catch (error) {
      console.warn('[placeCache] Lesen fehlgeschlagen', error);
      return null;
    }
  }

  async set(cellKey: string, places: Place[]): Promise<void> {
    try {
      const data = {
        fetchedAt: new Date(),
        payload: places as unknown as object,
      };
      await client().placeCache.upsert({
        where: { cellKey },
        create: { cellKey, ...data },
        update: data,
      });
      void this.cleanupOccasionally();
    } catch (error) {
      console.warn('[placeCache] Schreiben fehlgeschlagen', error);
    }
  }

  /** Alte Kacheln höchstens einmal pro Stunde wegräumen. */
  private async cleanupOccasionally(): Promise<void> {
    if (Date.now() - this.lastCleanup < 60 * 60 * 1000) return;
    this.lastCleanup = Date.now();
    try {
      const grenze = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await client().placeCache.deleteMany({ where: { fetchedAt: { lt: grenze } } });
    } catch {
      /* Aufräumen ist Kür, kein Pflichtprogramm. */
    }
  }
}
