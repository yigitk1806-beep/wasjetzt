import type { Plan } from '@/types/domain';
import { FallbackPlanStore } from './fallbackPlanStore';
import { PrismaPlanStore } from './prismaPlanStore';

/**
 * Speicher für Pläne. Bewusst als Interface, damit der In-Memory-Store
 * für das MVP später gegen Postgres (Prisma/Drizzle) getauscht werden kann,
 * ohne dass Routen oder Engine sich ändern. Siehe db/schema.prisma.
 */
export interface PlanStore {
  save(plan: Plan): Promise<Plan>;
  get(id: string): Promise<Plan | null>;
  getByShareCode(code: string): Promise<Plan | null>;
  update(id: string, mutate: (plan: Plan) => Plan): Promise<Plan | null>;
  delete(id: string): Promise<boolean>;
}

type Entry = { plan: Plan; savedAt: number };

/**
 * Prozessweiter Speicher. Hinweis: Pläne überleben keinen Serverneustart
 * und werden nach 24 Stunden verworfen. Für das MVP reicht das; ein
 * geteilter Link funktioniert, solange der Server läuft.
 */
export class InMemoryPlanStore implements PlanStore {
  private entries = new Map<string, Entry>();
  private byShare = new Map<string, string>();
  private readonly ttlMs = 24 * 60 * 60 * 1000;
  private readonly maxEntries = 5000;

  async save(plan: Plan): Promise<Plan> {
    this.evict();
    const stored: Plan = {
      ...plan,
      expiresAtISO: new Date(Date.now() + this.ttlMs).toISOString(),
    };
    this.entries.set(stored.id, { plan: stored, savedAt: Date.now() });
    this.byShare.set(stored.shareCode, stored.id);
    return stored;
  }

  async get(id: string): Promise<Plan | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (Date.now() - entry.savedAt > this.ttlMs) {
      this.entries.delete(id);
      this.byShare.delete(entry.plan.shareCode);
      return null;
    }
    return entry.plan;
  }

  async getByShareCode(code: string): Promise<Plan | null> {
    const id = this.byShare.get(code);
    return id ? this.get(id) : null;
  }

  async update(id: string, mutate: (plan: Plan) => Plan): Promise<Plan | null> {
    const current = await this.get(id);
    if (!current) return null;
    const next = mutate(current);
    this.entries.set(id, { plan: next, savedAt: Date.now() });
    this.byShare.set(next.shareCode, id);
    return next;
  }

  async delete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    this.byShare.delete(entry.plan.shareCode);
    return true;
  }

  private evict() {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (now - entry.savedAt > this.ttlMs) {
        this.entries.delete(id);
        this.byShare.delete(entry.plan.shareCode);
      }
    }
    if (this.entries.size >= this.maxEntries) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].savedAt - b[1].savedAt);
      for (const [id, entry] of oldest.slice(0, Math.floor(this.maxEntries * 0.2))) {
        this.entries.delete(id);
        this.byShare.delete(entry.plan.shareCode);
      }
    }
  }
}

const globalForStore = globalThis as unknown as { __wasjetztPlanStore?: PlanStore };

/**
 * Mit `DATABASE_URL` läuft die Persistenz über Postgres, sonst über den
 * Arbeitsspeicher. So funktioniert die App lokal ohne Datenbank, und in der
 * Produktion überleben geteilte Links Neustarts – ohne Code-Änderung.
 */
export function getPlanStore(): PlanStore {
  if (!globalForStore.__wasjetztPlanStore) {
    globalForStore.__wasjetztPlanStore = process.env.DATABASE_URL
      ? // Datenbank mit Spiegel im Arbeitsspeicher: Ein DB-Ausfall kostet die
        // Dauerhaftigkeit, aber nicht den Plan des Nutzers.
        new FallbackPlanStore(new PrismaPlanStore(), new InMemoryPlanStore())
      : new InMemoryPlanStore();
  }
  return globalForStore.__wasjetztPlanStore;
}

/** Für Statusanzeigen: Läuft die App mit echter Datenbank? */
export function isPersistent(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
