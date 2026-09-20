import { NextResponse } from 'next/server';
import { getPlanStore } from '@/db/planStore';
import { weatherAt } from '@/engine/planBuilder';
import { isWeatherBlocked, weatherModeOf } from '@/engine/weatherRules';
import { getProviders } from '@/providers/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Prüft, ob ein bestehender Plan durch eine Wetteränderung schlechter
 * geworden ist. Liefert die betroffenen Schritte – ersetzt aber nichts
 * von selbst. Die Entscheidung bleibt beim Nutzer.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const plan = await getPlanStore().get(id);
  if (!plan) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  try {
    const forecast = await getProviders().weather.forecast(plan.request.origin, 24);
    if (forecast.source === 'fallback') {
      return NextResponse.json({ changed: false, affectedStepIds: [] });
    }

    const affected = plan.steps.filter((step) => {
      if (step.place.indoorOutdoor === 'indoor') return false;
      const slice = weatherAt(forecast, step.startISO);
      if (!slice) return false;
      const nowBlocked = isWeatherBlocked(step.place, slice);
      const wasFine = plan.weatherAtCreation
        ? !isWeatherBlocked(step.place, plan.weatherAtCreation)
        : true;
      return nowBlocked && wasFine;
    });

    return NextResponse.json({
      changed: affected.length > 0,
      affectedStepIds: affected.map((s) => s.id),
      mode: weatherModeOf(forecast.now),
      now: forecast.now,
    });
  } catch (error) {
    console.error('[api/plan/weather-check]', error);
    return NextResponse.json({ changed: false, affectedStepIds: [] });
  }
}
