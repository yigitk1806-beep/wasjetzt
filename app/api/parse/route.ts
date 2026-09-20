import { NextResponse } from 'next/server';
import { getProviders } from '@/providers/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Übersetzt Freitext in Planparameter – für die Live-Vorschau im Formular. */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ understood: [], moods: [] });
  }

  const text = typeof body.text === 'string' ? body.text.slice(0, 500) : '';
  const locale = typeof body.locale === 'string' ? body.locale.slice(0, 5) : 'de';

  if (!text.trim()) return NextResponse.json({ understood: [], moods: [] });

  try {
    const intent = await getProviders().language.parse(text, locale);
    return NextResponse.json(intent);
  } catch (error) {
    console.error('[api/parse]', error);
    return NextResponse.json({ understood: [], moods: [] });
  }
}
