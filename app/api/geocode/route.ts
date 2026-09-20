import { NextResponse } from 'next/server';
import { getProviders } from '@/providers/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ortssuche für die Standortauswahl. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') ?? '').slice(0, 80);
  const locale = (searchParams.get('locale') ?? 'de').slice(0, 5);

  if (query.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await getProviders().geocoding.search(query, locale);
    return NextResponse.json({ results });
  } catch (error) {
    console.error('[api/geocode]', error);
    return NextResponse.json({ results: [] });
  }
}
