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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = await getPlanStore().delete(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
