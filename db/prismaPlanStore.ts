import { PrismaClient } from '@prisma/client';
import type { Plan } from '@/types/domain';
import type { PlanStore } from './planStore';

/** Wie lange ein geteilter Plan abrufbar bleibt. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
 * Speichert Pläne in Postgres. Der Plan selbst liegt als JSON in `payload`;
 * die herausgezogenen Spalten dienen nur Abfragen und Aufräumarbeiten.
 *
 * Abgelaufene Pläne werden beim Lesen ignoriert und gelegentlich gelöscht –
 * das spart einen separaten Cron-Job.
 */
export class PrismaPlanStore implements PlanStore {
  private lastCleanup = 0;

  async save(plan: Plan): Promise<Plan> {
    const expiresAt = new Date(Date.now() + TTL_MS);
    const stored: Plan = { ...plan, expiresAtISO: expiresAt.toISOString() };

    const row = {
      shareCode: stored.shareCode,
      title: stored.title,
      summary: stored.summary,
      variant: stored.variant,
      startAt: new Date(stored.startISO),
      endAt: new Date(stored.endISO),
      expiresAt,
      payload: stored as unknown as object,
    };

    await client().plan.upsert({
      where: { id: stored.id },
      create: { id: stored.id, ...row },
      update: row,
    });

    void this.cleanupOccasionally();
    return stored;
  }

  async get(id: string): Promise<Plan | null> {
    const row = await client().plan.findUnique({ where: { id } });
    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    return row.payload as unknown as Plan;
  }

  async getByShareCode(code: string): Promise<Plan | null> {
    const row = await client().plan.findUnique({ where: { shareCode: code } });
    if (!row || row.expiresAt.getTime() < Date.now()) return null;
    return row.payload as unknown as Plan;
  }

  /**
   * Lesen, Ändern, Schreiben in einer Transaktion – sonst könnten sich zwei
   * gleichzeitige Zusagen in einer Gruppe gegenseitig überschreiben.
   */
  async update(id: string, mutate: (plan: Plan) => Plan): Promise<Plan | null> {
    return client().$transaction(async (tx) => {
      const row = await tx.plan.findUnique({ where: { id } });
      if (!row || row.expiresAt.getTime() < Date.now()) return null;

      const next = mutate(row.payload as unknown as Plan);
      await tx.plan.update({
        where: { id },
        data: {
          title: next.title,
          summary: next.summary,
          variant: next.variant,
          startAt: new Date(next.startISO),
          endAt: new Date(next.endISO),
          payload: next as unknown as object,
        },
      });
      return next;
    });
  }

  async delete(id: string): Promise<boolean> {
    try {
      await client().plan.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /** Höchstens einmal pro Stunde aufräumen. */
  private async cleanupOccasionally(): Promise<void> {
    if (Date.now() - this.lastCleanup < 60 * 60 * 1000) return;
    this.lastCleanup = Date.now();
    try {
      await client().plan.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    } catch (error) {
      console.warn('[planStore] Aufräumen fehlgeschlagen', error);
    }
  }
}
