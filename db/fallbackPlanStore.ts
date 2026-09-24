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

  /**
   * Warum der letzte Schreibversuch scheiterte – als kurze Einordnung, nie
   * als Originalmeldung. Ohne das steht auf der Gesundheitsseite nur, DASS
   * es nicht klappt; gesucht wird dann an der falschen Stelle.
   */
  private letzterFehler: string | null = null;

  get fehlerart(): string | null {
    return this.letzterFehler;
  }

  async save(plan: Plan): Promise<Plan> {
    try {
      const saved = await this.primary.save(plan);
      this.letzterFehler = null;
      // Spiegel aktuell halten, aber ohne den Erfolgsfall zu verzögern.
      void this.mirror.save(saved).catch(() => undefined);
      return saved;
    } catch (error) {
      this.letzterFehler = einordnen(error);
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

/**
 * Ordnet einen Datenbankfehler einer Ursache zu.
 *
 * Bewusst nur ein Stichwort: Die Originalmeldung von Prisma enthält Host und
 * Benutzer der Verbindung; die gehören nicht in eine öffentliche Antwort.
 */
function einordnen(error: unknown): string {
  const text = [
    error instanceof Error ? error.message : String(error),
    error instanceof Error && error.cause instanceof Error ? error.cause.message : '',
  ].join(' ');

  if (/authentication|password|credentials/i.test(text)) return 'Anmeldedaten werden abgelehnt';
  if (/Can't reach|ECONNREFUSED|ENOTFOUND/i.test(text)) return 'Server nicht erreichbar';
  if (/Timed out|ETIMEDOUT/i.test(text)) return 'Zeitüberschreitung';
  if (/does not exist|relation .* does not exist/i.test(text)) return 'Tabelle fehlt';
  if (/query engine|binary|libssl|engine.*not found/i.test(text)) return 'Prisma-Engine fehlt';
  if (/environment variable|DATABASE_URL|invalid .*url|protocol/i.test(text)) {
    return 'Verbindungszeichenfolge unbrauchbar';
  }

  // Nichts erkannt: eine bereinigte Kurzfassung, damit die Suche weitergeht.
  // Alles in Backticks (Host, Benutzer, Datenbank) und jede URL fliegen raus.
  const bereinigt = text
    .replace(/`[^`]*`/g, '…')
    .replace(/[a-z]+:\/\/\S+/gi, '…')
    .replace(/\s+/g, ' ')
    .trim();
  return `${error instanceof Error ? error.name : 'Fehler'}: ${bereinigt.slice(0, 120)}`;
}
