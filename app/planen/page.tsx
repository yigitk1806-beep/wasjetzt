'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { PlanningOverlay } from '@/components/PlanningOverlay';
import { ArrowRight } from '@/components/ui/icons';
import {
  TimeField,
  clockFromMin,
  jetztText,
  minutesOf,
  nextQuarter,
  startLabel,
  startMinutes,
  useNowClock,
} from '@/components/ui/TimeField';
import { useLocale } from '@/components/LocaleProvider';
import { useLocation } from '@/hooks/useLocation';
import { loadPreferences } from '@/lib/clientStore';
import { requestPlanStreamed, type PlanPhase } from '@/lib/planClient';
import type { BudgetPreset, Mobility, Mood, Party } from '@/types/domain';

const PARTIES: Array<{ value: Party; emoji: string; label: string }> = [
  { value: 'solo', emoji: '👤', label: 'Alleine' },
  { value: 'partner', emoji: '❤️', label: 'Zu zweit' },
  { value: 'friends', emoji: '👥', label: 'Freunde' },
  { value: 'family', emoji: '👨‍👩‍👧', label: 'Familie' },
];

const TIMES: Array<{ minutes: number; label: string }> = [
  { minutes: 90, label: '1–2 Std.' },
  { minutes: 180, label: '2–4 Std.' },
  { minutes: 300, label: '4–6 Std.' },
  { minutes: 480, label: 'Ganzer Tag' },
];

const BUDGETS: Array<{ value: BudgetPreset; label: string }> = [
  { value: 'free', label: 'Kostenlos' },
  { value: 'low', label: 'bis 20 €' },
  { value: 'medium', label: 'bis 50 €' },
  { value: 'high', label: 'bis 100 €' },
  { value: 'any', label: 'Egal' },
];

const MOODS: Array<{ value: Mood; emoji: string; label: string }> = [
  { value: 'date', emoji: '❤️', label: 'Date' },
  { value: 'action', emoji: '🔥', label: 'Action' },
  { value: 'chill', emoji: '😌', label: 'Entspannt' },
  { value: 'party', emoji: '🎉', label: 'Party' },
  { value: 'food', emoji: '🍔', label: 'Essen' },
  { value: 'nature', emoji: '🌳', label: 'Natur' },
  { value: 'gaming', emoji: '🎮', label: 'Gaming' },
  { value: 'new', emoji: '🆕', label: 'Neu' },
];

const MOBILITY: Array<{ value: Mobility; emoji: string; label: string }> = [
  { value: 'walk', emoji: '🚶', label: 'Fuß' },
  { value: 'bike', emoji: '🚲', label: 'Rad' },
  { value: 'transit', emoji: '🚇', label: 'Bus & Bahn' },
  { value: 'car', emoji: '🚗', label: 'Auto' },
];

export default function BuildPlanPage() {
  const router = useRouter();
  const { t } = useLocale();
  const { location } = useLocation();

  const [rawText, setRawText] = useState('');
  const [understood, setUnderstood] = useState<string[]>([]);
  const [party, setParty] = useState<Party>('friends');
  const [minutes, setMinutes] = useState(180);
  const [budget, setBudget] = useState<BudgetPreset>('any');
  const [moods, setMoods] = useState<Mood[]>([]);
  const [mobility, setMobility] = useState<Mobility>('transit');
  // Beide Uhrzeiten als Ortszeit ("14:30"); null = jetzt bzw. keine Endzeit.
  const [startAt, setStartAt] = useState<string | null>(null);
  const [homeBy, setHomeBy] = useState<string | null>(null);
  // Hat der Nutzer die Dauer selbst gewählt? Sonst passt sie sich dem
  // Zeitfenster zwischen Start und Heimkehr an.
  const [minutesTouched, setMinutesTouched] = useState(false);
  const jetzt = useNowClock();
  const [singleActivity, setSingleActivity] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<PlanPhase | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prefs = loadPreferences();
    setParty(prefs.defaultParty);
    setMobility(prefs.defaultMobility);
  }, []);

  // Freitext live auswerten, damit der Nutzer sieht, was ankommt.
  useEffect(() => {
    if (rawText.trim().length < 6) {
      setUnderstood([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText }),
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data) => {
          setUnderstood(data.understood ?? []);
          applyIntent(data);
        })
        .catch(() => undefined);
    }, 420);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawText]);

  function applyIntent(intent: Record<string, unknown>) {
    if (typeof intent.party === 'string') setParty(intent.party as Party);
    if (typeof intent.availableMinutes === 'number') {
      setMinutes(intent.availableMinutes);
      setMinutesTouched(true);
    }
    if (typeof intent.startMinutes === 'number') {
      setStartAt(clockFromMin(intent.startMinutes));
      setShowMore(true);
    }
    if (typeof intent.budget === 'string') setBudget(intent.budget as BudgetPreset);
    if (typeof intent.mobility === 'string') setMobility(intent.mobility as Mobility);
    if (Array.isArray(intent.moods) && intent.moods.length > 0) {
      setMoods(intent.moods as Mood[]);
    }
    if (typeof intent.homeByMinutes === 'number') {
      setHomeBy(clockFromMin(intent.homeByMinutes));
      setShowMore(true);
    }
  }

  // Zeitfenster zwischen Start und Heimkehr – daran richtet sich die Dauer
  // aus, solange der Nutzer sie nicht selbst gewählt hat.
  const startMin = startMinutes(startAt, jetzt);
  const fensterMin =
    homeBy && startMin !== null ? (((minutesOf(homeBy) - startMin) % 1440) + 1440) % 1440 : null;
  useEffect(() => {
    if (fensterMin === null || minutesTouched) return;
    const passend = [...TIMES].reverse().find((t) => t.minutes <= fensterMin) ?? TIMES[0];
    setMinutes(passend.minutes);
  }, [fensterMin, minutesTouched]);

  async function submit() {
    if (!location) {
      router.push('/');
      return;
    }
    setBusy(true);
    setPhase(null);
    setError(null);

    const response = await requestPlanStreamed({
      lat: location.location.lat,
      lon: location.location.lon,
      originLabel: location.label,
      startISO: new Date().toISOString(),
      availableMinutes: minutes,
      party,
      budget,
      moods,
      mobility,
      // Uhrzeiten gehen als Ortszeit zum Server; der rechnet mit der
      // Zeitzone des Standorts, nicht mit der des Geräts.
      startLocal: startAt ?? undefined,
      homeByLocal: homeBy ?? undefined,
      singleActivity,
      rawText: rawText.trim() || undefined,
    }, setPhase);

    if (response.plan) {
      router.push(`/plan/${response.plan.id}`);
      return;
    }
    setBusy(false);
    setPhase(null);
    setError(response.message ?? response.error ?? t.plan.empty);
  }

  return (
    <>
      <header className="shell safe-top flex items-center gap-2 pt-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="tap -ml-2 grid h-10 w-10 place-items-center rounded-full text-ink-soft"
          aria-label={t.common.back}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="m15 6-6 6 6 6"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="text-[0.95rem] font-semibold text-ink-soft">{t.build.title}</span>
      </header>

      <main className="shell space-y-7 pb-40 pt-5">
        {/* Freitext zuerst – das ist der schnellste Weg. */}
        <section className="space-y-2">
          <label htmlFor="freetext" className="text-[0.95rem] font-bold tracking-tight">
            {t.build.freeText}
          </label>
          <textarea
            id="freetext"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={t.build.freeTextPlaceholder}
            rows={2}
            className="w-full resize-none rounded-3xl bg-canvas-raised px-4 py-3.5 text-[0.95rem] leading-relaxed shadow-card outline-none ring-brand-300 hairline placeholder:text-ink-faint focus:ring-2"
          />
          <AnimatePresence>
            {understood.length > 0 ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap gap-1.5 overflow-hidden pt-0.5"
              >
                {understood.map((item) => (
                  <span
                    key={item}
                    className="rounded-full bg-mint-100 px-2.5 py-1 text-[0.76rem] font-medium text-mint-700"
                  >
                    ✓ {item}
                  </span>
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>

        <Section title={t.build.who}>
          <div className="flex flex-wrap gap-2">
            {PARTIES.map((option) => (
              <Chip
                key={option.value}
                emoji={option.emoji}
                selected={party === option.value}
                onClick={() => setParty(option.value)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title={t.build.time}>
          <div className="flex flex-wrap gap-2">
            {TIMES.map((option) => (
              <Chip
                key={option.minutes}
                selected={minutes === option.minutes}
                onClick={() => {
                  setMinutes(option.minutes);
                  setMinutesTouched(true);
                }}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title={t.build.budget}>
          <div className="flex flex-wrap gap-2">
            {BUDGETS.map((option) => (
              <Chip
                key={option.value}
                selected={budget === option.value}
                onClick={() => setBudget(option.value)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title={t.build.mood}>
          <div className="flex flex-wrap gap-2">
            {MOODS.map((option) => (
              <Chip
                key={option.value}
                emoji={option.emoji}
                selected={moods.includes(option.value)}
                onClick={() =>
                  setMoods((current) =>
                    current.includes(option.value)
                      ? current.filter((m) => m !== option.value)
                      : [...current, option.value].slice(-3),
                  )
                }
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </Section>

        <div>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="tap flex w-full items-center justify-between rounded-2xl bg-canvas-sunk px-4 py-3 text-[0.88rem] font-medium text-ink-soft"
          >
            <span className="min-w-0 truncate text-left">
              {t.build.more}
              {startAt || homeBy ? (
                <span className="font-semibold text-brand-600">
                  {startAt ? ` · Start ${startAt}` : ''}
                  {homeBy ? ` · Zuhause ${homeBy}` : ''}
                </span>
              ) : null}
            </span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
              className={`transition-transform ${showMore ? 'rotate-180' : ''}`}
            >
              <path
                d="m6 9 6 6 6-6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <AnimatePresence>
            {showMore ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-5 overflow-hidden pt-5"
              >
                <div className="space-y-2.5">
                  <TimeField
                    icon="🕐"
                    label="Wann starten?"
                    value={startAt}
                    emptyText={jetztText(jetzt)}
                    valueText={(v) => startLabel(v)}
                    actionText="Startzeit ändern"
                    resetText="Jetzt"
                    pickerDefault={nextQuarter(jetzt)}
                    onChange={setStartAt}
                  />
                  <TimeField
                    icon="🏠"
                    label={t.build.homeBy}
                    value={homeBy}
                    emptyText="Keine feste Endzeit"
                    valueText={(v) => `${v} Uhr`}
                    actionText="Festlegen"
                    resetText="Keine"
                    pickerDefault={clockFromMin(Math.round(((startMin ?? 720) + 240) / 60) * 60)}
                    commitOnBlur
                    onChange={setHomeBy}
                  />
                  {fensterMin !== null ? (
                    <p className="px-1 text-[0.78rem] text-ink-muted">
                      {fensterMin < 60
                        ? 'Das ist sehr knapp – mit Hin- und Rückweg bleibt kaum Zeit.'
                        : `Bis dahin bleiben ${Math.floor(fensterMin / 60)} Std.${fensterMin % 60 ? ` ${fensterMin % 60} Min.` : ''} – der Rückweg wird eingerechnet.`}
                    </p>
                  ) : null}
                </div>

                <Section title={t.build.mobility}>
                  <div className="flex flex-wrap gap-2">
                    {MOBILITY.map((option) => (
                      <Chip
                        key={option.value}
                        emoji={option.emoji}
                        selected={mobility === option.value}
                        onClick={() => setMobility(option.value)}
                      >
                        {option.label}
                      </Chip>
                    ))}
                  </div>
                </Section>

                <Chip
                  emoji="🎯"
                  selected={singleActivity}
                  onClick={() => setSingleActivity((v) => !v)}
                >
                  {t.build.single}
                </Chip>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {error ? (
          <p className="rounded-2xl bg-brand-50 px-4 py-3 text-[0.87rem] text-brand-700">{error}</p>
        ) : null}
      </main>

      {/* Die Hauptaktion. Immer erreichbar, immer die stärkste Fläche auf
          dem Bildschirm – der weiche Verlauf darüber trennt sie sichtbar
          vom letzten Abschnitt, statt sie daran kleben zu lassen. */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-canvas via-canvas/96 to-transparent pb-1 pt-10">
        <div className="shell safe-bottom">
          <Button
            size="lg"
            full
            loading={busy}
            loadingLabel="Plan wird erstellt"
            trailingIcon={<ArrowRight size={19} className="opacity-90" />}
            onClick={() => void submit()}
          >
            {t.build.submit}
          </Button>
        </div>
      </div>

      <PlanningOverlay open={busy} phase={phase} />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-[0.95rem] font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
