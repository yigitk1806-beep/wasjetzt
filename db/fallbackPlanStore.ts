import type { Plan } from '@/types/domain';
import type { PlanStore } from './planStore';

/**
 * Schreibt in die Datenbank und spiegelt jeden Plan zusätzlich in den
 * Arbeitsspeicher.
 *
 * Der Grund: Ein Datenbankausfall darf dem Nutzer nicht seinen gerade
 * erstellten Plan wegnehmen. Schlägt der Schreibvorgang fehl, existiert der
 * Plan trotzdem weiter – nur eben flüchtig und nicht über Instanzgrenzen
 * hinweg. Der Fehler wird geloggt, damit das nicht unbemerkt bleibt.
 *
 * Gelesen wird zuerst aus der Datenbank; findet sie nichts (oder antwortet
 * sie nicht), greift der Spiegel.
 */
export class FallbackPlanStore implements PlanStore {
  constructor(
    private readonly primary: PlanStore,
    private readonly mirror: PlanStore,
  ) {}

  async save(plan: Plan): Promise<Plan> {
    try {
      const saved = await this.primary.save(plan);
      // Spiegel aktuell halten, aber ohne den Erfolgsfall zu verzögern.
      void this.mirror.save(saved).catch(() => undefined);
      return saved;
    } catch (error) {
      console.error('[planStore] Datenbank nicht erreichbar, halte Plan flüchtig', error);
      return this.mirror.save(plan);
    }
  }

  async get(id: string): Promise<Plan | null> {
    try {
      const found = await this.primary.get(id);
      if (found) return found;
    } catch (error) {
      console.error('[planStore] Lesen aus der Datenbank fehlgeschlagen', error);
    }
    return this.mirror.get(id);
  }

  async getByShareCode(code: string): Promise<Plan | null> {
    try {
      const found = await this.primary.getByShareCode(code);
      if (found) return found;
    } catch (error) {
      console.error('[planStore] Lesen aus der Datenbank fehlgeschlagen', error);
    }
    return this.mirror.getByShareCode(code);
  }

  async update(id: string, mutate: (plan: Plan) => Plan): Promise<Plan | null> {
    try {
      const updated = await this.primary.update(id, mutate);
      if (updated) {
        void this.mirror.save(updated).catch(() => undefined);
        return updated;
      }
    } catch (error) {
      console.error('[planStore] Änderung in der Datenbank fehlgeschlagen', error);
    }
    return this.mirror.update(id, mutate);
  }

  async delete(id: string): Promise<boolean> {
    let ok = false;
    try {
      ok = await this.primary.delete(id);
    } catch (error) {
      console.error('[planStore] Löschen in der Datenbank fehlgeschlagen', error);
    }
    const mirrored = await this.mirror.delete(id);
    return ok || mirrored;
  }
}
