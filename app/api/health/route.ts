import { NextResponse } from 'next/server';
import { getPlanStore, isPersistent } from '@/db/planStore';
import { PrismaPlaceCache } from '@/db/prismaPlaceCache';
import { getProviders } from '@/providers/registry';
import { shortId } from '@/lib/id';
import type { Plan } from '@/types/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Betriebszustand der Anwendung.
 *
 * Existiert, weil ein stiller Rückfall auf den Arbeitsspeicher von außen nicht
 * zu erkennen ist: Die App funktioniert dann scheinbar, verliert aber geteilte
 * Pläne. Dieser Endpunkt schreibt und liest testweise einen Datensatz und sagt,
 * was tatsächlich passiert ist.
 *
 * Gibt bewusst keine Verbindungsdaten preis – nur Ja/Nein und die Fehlerart.
 */
export async function GET(request: Request) {
  const checks: Record<string, unknown> = {
    databaseUrlGesetzt: isPersistent(),
    ortsquelle: getProviders().places.id,
    // Welcher Stand läuft gerade? Ohne das ist von außen nicht zu erkennen,
    // ob ein Deployment schon durch ist.
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'lokal',
  };

  // Optional: Erreicht diese Instanz den Routing-Dienst? Nur auf Anfrage,
  // damit die Gesundheitspruefung selbst schnell bleibt. Ohne diesen Test
  // ist von aussen nicht zu unterscheiden, ob Wege geschaetzt sind, weil
  // OSRM kein Profil hat oder weil es von hier aus nicht antwortet.
  if (new URL(request.url).searchParams.get('routing') === '1') {
    const routing = getProviders().routing;
    const probe = (routing as { probe?: () => Promise<unknown> }).probe;
    checks.routing = probe ? await probe.call(routing) : 'kein Test verfuegbar';
  }

  // Optional: Lesetest auf den geteilten Ortscache, z. B. ?cell=53.560:10.000
  // Zeigt, ob eine vorgeladene Kachel von dieser Instanz aus gefunden wird
  // und wie lange das dauert.
  const cell = new URL(request.url).searchParams.get('cell');
  if (cell && isPersistent()) {
    const start = Date.now();
    try {
      const orte = await new PrismaPlaceCache().get(cell, 60 * 60 * 1000);
      checks.ortscache = {
        kachel: cell,
        gefunden: Boolean(orte),
        anzahl: orte?.length ?? 0,
        dauerMs: Date.now() - start,
      };
    } catch (error) {
      checks.ortscache = {
        kachel: cell,
        fehler: error instanceof Error ? error.name : 'unbekannt',
        dauerMs: Date.now() - start,
      };
    }
  }

  if (!isPersistent()) {
    checks.datenbank = 'nicht konfiguriert';
    return NextResponse.json({ ok: false, ...checks });
  }

  // Schreib-Lese-Probe: Nur so zeigt sich, ob die Verbindung wirklich steht.
  const probe = `health_${shortId(8)}`;
  const jetzt = new Date();
  const testPlan = {
    id: probe,
    shareCode: probe,
    title: 'Health-Check',
    summary: 'Wird sofort wieder gelöscht.',
    variant: 'balanced',
    steps: [],
    startISO: jetzt.toISOString(),
    endISO: jetzt.toISOString(),
    totalDurationMin: 0,
    cost: { level: 0, levelEstimated: false },
    currency: 'EUR',
    request: {
      origin: { lat: 0, lon: 0 },
      originLabel: 'health',
      startISO: jetzt.toISOString(),
      availableMinutes: 60,
      party: 'solo',
      groupSize: 1,
      budget: 'any',
      moods: [],
      mobility: 'walk',
      language: 'de',
      currency: 'EUR',
    },
    weatherAtCreation: null,
    createdAtISO: jetzt.toISOString(),
    notes: [],
    participants: [],
    containsMockData: false,
  } as unknown as Plan;

  const store = getPlanStore();
  const start = Date.now();

  try {
    const gespeichert = await store.save(testPlan);
    const tageGueltig =
      (new Date(gespeichert.expiresAtISO ?? 0).getTime() - Date.now()) / 86_400_000;

    // 7 Tage = Postgres, 1 Tag = Arbeitsspeicher-Rückfall.
    const ausDatenbank = tageGueltig > 6;
    await store.delete(probe);

    return NextResponse.json({
      ok: ausDatenbank,
      ...checks,
      datenbank: ausDatenbank ? 'verbunden' : 'Schreibversuch fiel auf Arbeitsspeicher zurück',
      gueltigkeitTage: Number(tageGueltig.toFixed(1)),
      dauerMs: Date.now() - start,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      ...checks,
      datenbank: 'Fehler',
      fehlerart: error instanceof Error ? error.name : 'unbekannt',
      // Nachricht gekürzt – Verbindungszeichenfolgen sollen nicht nach außen.
      hinweis: error instanceof Error ? error.message.slice(0, 120) : undefined,
      dauerMs: Date.now() - start,
    });
  }
}
