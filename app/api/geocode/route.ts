import { NextResponse } from 'next/server';
import { getProviders } from '@/providers/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Suche nach Startpunkten: Städte wie "Berlin" und echte Adressen wie
 * "Müllerstraße 120 Berlin". Mit `lat`/`lon` rücken Treffer in der Nähe nach
 * vorn. Mit `reverse=1` wird zu einem Punkt auf der Karte der Name gesucht.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') ?? '').slice(0, 120);
  const locale = (searchParams.get('locale') ?? 'de').slice(0, 5);
  const near = koordinaten(searchParams.get('lat'), searchParams.get('lon'));

  try {
    if (searchParams.get('reverse') === '1') {
      if (!near) return NextResponse.json({ result: null });
      const result = await getProviders().geocoding.reverse(near, locale);
      return NextResponse.json({ result });
    }

    if (query.trim().length < 2) return NextResponse.json({ results: [] });

    const results = await getProviders().geocoding.search(query, locale, near ?? undefined);
    return NextResponse.json({ results });
  } catch (error) {
    console.error('[api/geocode]', error);
    return NextResponse.json({ results: [], result: null });
  }
}

function koordinaten(lat: string | null, lon: string | null) {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: a, lon: b };
}
