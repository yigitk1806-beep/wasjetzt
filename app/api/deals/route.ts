import { NextResponse } from 'next/server';
import { haversineMeters, searchRadiusMeters } from '@/lib/geo';
import { getProviders } from '@/providers/registry';
import { isOpenDuring } from '@/lib/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Jetzt günstig": kurzfristige Angebote in der Nähe.
 * Im MVP stammen die Angebote aus den Demo-Daten und sind entsprechend
 * markiert. Später liefern Partner hier echte freie Kapazitäten.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'lat/lon fehlen.' }, { status: 400 });
  }

  try {
    const providers = getProviders();
    const center = { lat, lon };
    const radius = searchRadiusMeters('transit', 240);
    const places = await providers.places.search({ center, radiusMeters: radius, limit: 300 });
    const now = new Date();

    const deals = places
      .filter((p) => p.deal && p.openingHours && isOpenDuring(p.openingHours, now, 60))
      .map((p) => ({
        place: p,
        distanceMeters: Math.round(haversineMeters(center, p.location)),
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 6);

    return NextResponse.json({ deals, isMock: providers.places.isMock });
  } catch (error) {
    console.error('[api/deals]', error);
    return NextResponse.json({ deals: [], isMock: true });
  }
}
