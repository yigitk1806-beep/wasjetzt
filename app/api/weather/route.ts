import { NextResponse } from 'next/server';
import { getProviders } from '@/providers/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Aktuelles Wetter für den Kopf der Startseite. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'lat/lon fehlen.' }, { status: 400 });
  }

  try {
    const forecast = await getProviders().weather.forecast({ lat, lon }, 12);
    return NextResponse.json({
      now: forecast.now,
      sunsetISO: forecast.sunsetISO,
      sunriseISO: forecast.sunriseISO,
      source: forecast.source,
    });
  } catch (error) {
    console.error('[api/weather]', error);
    return NextResponse.json({ error: 'Wetter nicht verfügbar.' }, { status: 502 });
  }
}
