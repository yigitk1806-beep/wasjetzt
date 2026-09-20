import { NextResponse } from 'next/server';
import { getPlanStore } from '@/db/planStore';
import { shortId } from '@/lib/id';
import type { Category, Participant, Plan, RsvpStatus } from '@/types/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RSVPS: RsvpStatus[] = ['yes', 'maybe', 'no'];
const CATEGORIES: Category[] = [
  'food', 'cafe', 'bar', 'activity', 'cinema', 'culture',
  'nature', 'sport', 'gaming', 'wellness', 'shopping', 'event',
];

/**
 * Gruppenaktionen an einem Plan. Eine Route, vier Aktionen:
 *  - join:    Teilnehmer hinzufügen (ohne Registrierung)
 *  - rsvp:    Zusage / Vielleicht / Absage ändern
 *  - vote:    Stimme für eine Kategorie abgeben
 *  - meeting: Treffpunkt setzen
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const store = getPlanStore();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Ungültiger Body.' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action : '';

  const updated = await store.update(id, (plan) => {
    switch (action) {
      case 'join':
        return applyJoin(plan, body);
      case 'rsvp':
        return applyRsvp(plan, body);
      case 'vote':
        return applyVote(plan, body);
      case 'meeting':
        return applyMeeting(plan, body);
      default:
        return plan;
    }
  });

  if (!updated) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (!action) return NextResponse.json({ error: 'action fehlt.' }, { status: 400 });

  return NextResponse.json({ plan: updated });
}

function cleanName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().slice(0, 40) : '';
  return name || 'Gast';
}

function applyJoin(plan: Plan, body: Record<string, unknown>): Plan {
  const name = cleanName(body.name);
  const existing = plan.participants.find(
    (p) => p.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return plan;

  const rsvp: RsvpStatus =
    typeof body.rsvp === 'string' && (RSVPS as string[]).includes(body.rsvp)
      ? (body.rsvp as RsvpStatus)
      : 'maybe';

  const participant: Participant = { id: shortId(6), name, rsvp };
  return { ...plan, participants: [...plan.participants, participant].slice(0, 25) };
}

function applyRsvp(plan: Plan, body: Record<string, unknown>): Plan {
  const participantId = typeof body.participantId === 'string' ? body.participantId : '';
  const rsvp: RsvpStatus =
    typeof body.rsvp === 'string' && (RSVPS as string[]).includes(body.rsvp)
      ? (body.rsvp as RsvpStatus)
      : 'maybe';

  return {
    ...plan,
    participants: plan.participants.map((p) =>
      p.id === participantId ? { ...p, rsvp } : p,
    ),
  };
}

function applyVote(plan: Plan, body: Record<string, unknown>): Plan {
  const participantId = typeof body.participantId === 'string' ? body.participantId : '';
  const vote =
    typeof body.category === 'string' && (CATEGORIES as string[]).includes(body.category)
      ? (body.category as Category)
      : null;

  return {
    ...plan,
    participants: plan.participants.map((p) =>
      p.id === participantId ? { ...p, vote } : p,
    ),
  };
}

function applyMeeting(plan: Plan, body: Record<string, unknown>): Plan {
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) : '';
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const timeISO = typeof body.timeISO === 'string' ? body.timeISO : plan.startISO;

  if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) return plan;
  if (Number.isNaN(new Date(timeISO).getTime())) return plan;

  return {
    ...plan,
    meetingPoint: { label, location: { lat, lon }, timeISO },
  };
}
