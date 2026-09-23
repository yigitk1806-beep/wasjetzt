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
  minutesOf,
  nextQuarter,
  startDay,
  startMinutes,
  useNowClock,
} from '@/components/ui/TimeField';
import { duration, errorText } from '@/lib/i18n/format';
import type { UnderstoodToken } from '@/providers/types';
import { useLocale } from '@/components/LocaleProvider';
import { useLocation } from '@/hooks/useLocation';
import { loadPreferences } from '@/lib/clientStore';
import { requestPlanStreamed, type PlanPhase } from '@/lib/planClient';
import type { BudgetPreset, Mobility, Mood, Party } from '@/types/domain';

const PARTIES: Array<{ value: Party; emoji: string }> = [
  { value: 'solo', emoji: '👤' },
  { value: 'partner', emoji: '❤️' },
  { value: 'friends', emoji: '👥' },
  { value: 'family', emoji: '👨‍👩‍👧' },
];

const TIMES = [{ minutes: 90 }, { minutes: 180 }, { minutes: 300 }, { minutes: 480 }] as const;

const BUDGETS: BudgetPreset[] = ['free', 'low', 'medium', 'high', 'any'];

const MOODS: Array<{ value: Mood; emoji: string }> = [
  { value: 'date', emoji: '❤️' },
  { value: 'action', emoji: '🔥' },
  { value: 'chill', emoji: '😌' },
  { value: 'party', emoji: '🎉' },
  { value: 'food', emoji: '🍔' },
  { value: 'nature', emoji: '🌳' },
  { value: 'gaming', emoji: '🎮' },
  { value: 'new', emoji: '🆕' },
];

const MOBILITY: Array<{ value: Mobility; emoji: string }> = [
  { value: 'walk', emoji: '🚶' },
  { value: 'bike', emoji: '🚲' },
  { value: 'transit', emoji: '🚇' },
  { value: 'car', emoji: '🚗' },
];

export default function BuildPlanPage() {
  const router = useRouter();
  const { t, locale } = useLocale();
  const { location } = useLocation();

  const [rawText, setRawText] = useState('');
  const [understood, setUnderstood] = useState<UnderstoodToken[]>([]);
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
        body: JSON.stringify({ text: rawText, locale }),
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data) => {
          setUnderstood(data.understoodTokens ?? []);
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
    setError(errorText(t, response));
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
                {understood.map((token) => {
                  const eintrag = t.understood[token.key] as string | ((...a: Array<string | number>) => string);
                  const text = typeof eintrag === 'function' ? eintrag(...(token.args ?? [])) : eintrag;
                  return (
                    <span
                      key={`${token.key}-${(token.args ?? []).join('-')}`}
                      className="rounded-full bg-mint-100 px-2.5 py-1 text-[0.76rem] font-medium text-mint-700"
                    >
                      ✓ {text}
                    </span>
                  );
                })}
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
                {t.build.parties[option.value]}
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
                {t.build.times[option.minutes]}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title={t.build.budget}>
          <div className="flex flex-wrap gap-2">
            {BUDGETS.map((option) => (
              <Chip
                key={option}
                selected={budget === option}
                onClick={() => setBudget(option)}
              >
                {t.build.budgets[option]}
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
                {t.build.moods[option.value]}
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
                  {startAt ? ` · ${t.build.summaryStart(startAt)}` : ''}
                  {homeBy ? ` · ${t.build.summaryHome(homeBy)}` : ''}
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
                    label={t.time.startLabel}
                    value={startAt}
                    emptyText={jetzt ? t.time.nowAt(jetzt) : t.time.now}
                    valueText={(v) => t.time.startValue(startDay(v), v)}
                    actionText={t.time.changeStart}
                    resetText={t.time.now}
                    pickerDefault={nextQuarter(jetzt)}
                    onChange={setStartAt}
                  />
                  <TimeField
                    icon="🏠"
                    label={t.time.homeLabel}
                    value={homeBy}
                    emptyText={t.time.homeNone}
                    valueText={(v) => t.time.homeValue(v)}
                    actionText={t.time.homeSet}
            changeText={t.time.change}
                    resetText={t.time.homeClear}
                    pickerDefault={clockFromMin(Math.round(((startMin ?? 720) + 240) / 60) * 60)}
                    commitOnBlur
                    onChange={setHomeBy}
                  />
                  {fensterMin !== null ? (
                    <p className="px-1 text-[0.78rem] text-ink-muted">
                      {fensterMin < 60
                        ? t.build.windowTight
                        : t.build.windowLeft(duration(t, fensterMin))}
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
                        {t.build.mobilities[option.value]}
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
            loadingLabel={t.build.submitting}
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
