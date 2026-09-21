'use client';

import { useEffect, useMemo, useState } from 'react';
import { Chip } from '@/components/ui/Chip';
import { Button } from '@/components/ui/Button';
import { formatClock } from '@/lib/time';
import { groupAction } from '@/lib/planClient';
import type { Category, Plan, RsvpStatus } from '@/types/domain';

const RSVP_EMOJI: Record<RsvpStatus, string> = { yes: '✅', maybe: '🤔', no: '❌' };
const RSVP_LABEL: Record<RsvpStatus, string> = {
  yes: 'Zugesagt',
  maybe: 'Vielleicht',
  no: 'Nicht dabei',
};

const VOTE_OPTIONS: Array<{ category: Category; emoji: string; label: string }> = [
  { category: 'activity', emoji: '🎳', label: 'Aktivität' },
  { category: 'gaming', emoji: '🎮', label: 'Gaming' },
  { category: 'cinema', emoji: '🎬', label: 'Kino' },
  { category: 'bar', emoji: '🍹', label: 'Bar' },
  { category: 'food', emoji: '🍽️', label: 'Essen' },
  { category: 'nature', emoji: '🌳', label: 'Draußen' },
];

function storageKey(planId: string) {
  return `wasjetzt.participant.${planId}`;
}

type Props = {
  plan: Plan;
  onPlanChange: (plan: Plan) => void;
};

/**
 * Gruppenteil des Plans. Erscheint erst, wenn er gebraucht wird –
 * also sobald jemand teilnimmt oder der Plan geteilt wurde.
 */
export function GroupPanel({ plan, onPlanChange }: Props) {
  const [myId, setMyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setMyId(window.localStorage.getItem(storageKey(plan.id)));
    } catch {
      setMyId(null);
    }
  }, [plan.id]);

  const me = useMemo(
    () => plan.participants.find((p) => p.id === myId) ?? null,
    [plan.participants, myId],
  );

  const voteCounts = useMemo(() => {
    const counts = new Map<Category, number>();
    for (const participant of plan.participants) {
      if (!participant.vote) continue;
      counts.set(participant.vote, (counts.get(participant.vote) ?? 0) + 1);
    }
    return counts;
  }, [plan.participants]);

  async function join() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    const updated = await groupAction(plan.id, { action: 'join', name: trimmed, rsvp: 'yes' });
    setBusy(false);
    if (!updated) return;

    const created = updated.participants.find(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (created) {
      try {
        window.localStorage.setItem(storageKey(plan.id), created.id);
      } catch {
        /* ohne Speicher funktioniert es auch, nur ohne Wiedererkennung */
      }
      setMyId(created.id);
    }
    setJoining(false);
    setName('');
    onPlanChange(updated);
  }

  async function setRsvp(rsvp: RsvpStatus) {
    if (!me) return;
    setBusy(true);
    const updated = await groupAction(plan.id, {
      action: 'rsvp',
      participantId: me.id,
      rsvp,
    });
    setBusy(false);
    if (updated) onPlanChange(updated);
  }

  async function vote(category: Category) {
    if (!me) return;
    setBusy(true);
    const updated = await groupAction(plan.id, {
      action: 'vote',
      participantId: me.id,
      category: me.vote === category ? null : category,
    });
    setBusy(false);
    if (updated) onPlanChange(updated);
  }

  async function setMeetingPoint() {
    const first = plan.steps[0];
    if (!first) return;
    setBusy(true);
    const updated = await groupAction(plan.id, {
      action: 'meeting',
      label: first.place.name,
      lat: first.place.location.lat,
      lon: first.place.location.lon,
      timeISO: first.startISO,
    });
    setBusy(false);
    if (updated) onPlanChange(updated);
  }

  const hasGroup = plan.participants.length > 0;

  return (
    <section className="space-y-3 rounded-3xl bg-canvas-raised p-4 shadow-card hairline">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[0.95rem] font-bold tracking-tight">Wer kommt mit?</h2>
        {hasGroup ? (
          <span className="text-[0.76rem] text-ink-faint">
            {plan.participants.filter((p) => p.rsvp === 'yes').length} zugesagt
          </span>
        ) : null}
      </div>

      {hasGroup ? (
        <ul className="space-y-1.5">
          {plan.participants.map((participant) => (
            <li
              key={participant.id}
              className="flex items-center justify-between gap-3 text-[0.9rem]"
            >
              <span className="min-w-0 truncate font-medium">
                {participant.name}
                {participant.id === myId ? (
                  <span className="text-ink-faint"> (du)</span>
                ) : null}
              </span>
              <span className="shrink-0 text-[0.82rem] text-ink-muted">
                {RSVP_EMOJI[participant.rsvp]} {RSVP_LABEL[participant.rsvp]}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.86rem] text-ink-muted">
          Teil den Plan – wer ihn öffnet, kann hier zusagen.
        </p>
      )}

      {me ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {(['yes', 'maybe', 'no'] as RsvpStatus[]).map((status) => (
            <Chip
              key={status}
              emoji={RSVP_EMOJI[status]}
              selected={me.rsvp === status}
              disabled={busy}
              onClick={() => void setRsvp(status)}
            >
              {RSVP_LABEL[status]}
            </Chip>
          ))}
        </div>
      ) : joining ? (
        <form
          className="flex gap-2 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dein Name"
            autoFocus
            enterKeyHint="done"
            className="min-w-0 flex-1 rounded-2xl bg-canvas-sunk px-4 py-2.5 text-[0.92rem] outline-none ring-brand-300 focus:ring-2"
          />
          <Button type="submit" size="md" loading={busy}>
            Dabei
          </Button>
        </form>
      ) : (
        <Button variant="secondary" size="md" full onClick={() => setJoining(true)}>
          Ich bin dabei
        </Button>
      )}

      {/* Treffpunkt */}
      <div className="border-t border-line pt-3">
        {plan.meetingPoint ? (
          <p className="text-[0.88rem]">
            <span className="font-semibold">📍 {plan.meetingPoint.label}</span>
            <span className="text-ink-muted"> · {formatClock(plan.meetingPoint.timeISO, 'de', plan.tzOffsetMin)}</span>
          </p>
        ) : (
          <button
            type="button"
            onClick={() => void setMeetingPoint()}
            disabled={busy || plan.steps.length === 0}
            className="tap text-[0.86rem] font-semibold text-brand-600 disabled:opacity-50"
          >
            📍 Treffpunkt festlegen
          </button>
        )}
      </div>

      {/* Voting – erst sinnvoll, wenn mehrere dabei sind. */}
      {plan.participants.length >= 2 && me ? (
        <div className="border-t border-line pt-3">
          <h3 className="mb-2 text-[0.88rem] font-semibold">Worauf habt ihr Lust?</h3>
          <div className="flex flex-wrap gap-2">
            {VOTE_OPTIONS.map((option) => {
              const count = voteCounts.get(option.category) ?? 0;
              return (
                <Chip
                  key={option.category}
                  emoji={option.emoji}
                  selected={me.vote === option.category}
                  disabled={busy}
                  onClick={() => void vote(option.category)}
                >
                  {option.label}
                  {count > 0 ? <span className="ml-1 opacity-70">{count}</span> : null}
                </Chip>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
