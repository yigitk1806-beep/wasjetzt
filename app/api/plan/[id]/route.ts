import { NextResponse } from 'next/server';
import { getPlanStore } from '@/db/planStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const plan = await getPlanStore().get(id);
  if (!plan) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  return NextResponse.json({ plan });
}

// Hier stand bis zum 11.11.2026 ein DELETE ohne jede Prüfung. Die
// Plankennung steht aber in jedem geteilten Link – wer einen Plan geschickt
// bekam, konnte ihn mit einem einzigen Aufruf für die ganze Gruppe löschen.
// Die App selbst hat den Endpunkt nie benutzt; die Gesundheitsprüfung
// räumt ihren Testplan direkt über den Speicher ab. Ohne Konten gibt es
// niemanden, dem Löschen zustünde – Pläne verfallen nach sieben Tagen von
// selbst. Kommt einmal ein Löschknopf, braucht er einen Besitznachweis.
