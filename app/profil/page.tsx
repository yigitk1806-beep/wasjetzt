'use client';

import { useEffect, useState } from 'react';
import { Chip } from '@/components/ui/Chip';
import { Button } from '@/components/ui/Button';
import { useLocale } from '@/components/LocaleProvider';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n';
import {
  clearEverything,
  loadLocation,
  loadPreferences,
  updatePreferences,
  type StoredLocation,
} from '@/lib/clientStore';
import { CATEGORY_EMOJI, CATEGORY_LABEL } from '@/providers/activityProfiles';
import type { Category, UserPreferences } from '@/types/domain';

export default function ProfilePage() {
  const { t, locale, setLocale } = useLocale();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [location, setLocation] = useState<StoredLocation | null>(null);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    setPrefs(loadPreferences());
    setLocation(loadLocation());
  }, []);

  function toggleDislike(category: Category) {
    setPrefs(
      updatePreferences((current) => {
        const dislikes = { ...current.dislikes };
        const likes = { ...current.likes };
        if ((dislikes[category] ?? 0) >= 0.5) {
          delete dislikes[category];
        } else {
          dislikes[category] = 1;
          delete likes[category];
        }
        return { ...current, dislikes, likes };
      }),
    );
  }

  const liked = prefs
    ? (Object.entries(prefs.likes) as Array<[Category, number]>)
        .filter(([, weight]) => weight >= 0.3)
        .sort((a, b) => b[1] - a[1])
    : [];
  const disliked = prefs
    ? (Object.entries(prefs.dislikes) as Array<[Category, number]>)
        .filter(([, weight]) => weight >= 0.3)
        .sort((a, b) => b[1] - a[1])
    : [];

  return (
    <main className="shell space-y-7 pt-8">
      <h1 className="text-[2rem] font-bold tracking-[-0.03em]">{t.profile.title}</h1>

      {/* Vorlieben */}
      <section className="space-y-3">
        <h2 className="text-[0.95rem] font-bold tracking-tight">{t.profile.preferences}</h2>

        {liked.length === 0 && disliked.length === 0 ? (
          <p className="text-[0.88rem] text-ink-muted">{t.profile.noData}</p>
        ) : null}

        {liked.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[0.82rem] text-ink-muted">{t.profile.liked}</p>
            <div className="flex flex-wrap gap-2">
              {liked.map(([category]) => (
                <span
                  key={category}
                  className="rounded-2xl bg-mint-100 px-3.5 py-2 text-[0.88rem] font-medium text-mint-700"
                >
                  {CATEGORY_EMOJI[category]} {CATEGORY_LABEL[category]}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-[0.82rem] text-ink-muted">{t.profile.disliked}</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((category) => (
              <Chip
                key={category}
                emoji={CATEGORY_EMOJI[category]}
                selected={(prefs?.dislikes[category] ?? 0) >= 0.5}
                onClick={() => toggleDislike(category)}
              >
                {CATEGORY_LABEL[category]}
              </Chip>
            ))}
          </div>
        </div>
      </section>

      {/* Sprache */}
      <section className="space-y-3">
        <h2 className="text-[0.95rem] font-bold tracking-tight">{t.profile.language}</h2>
        <div className="flex flex-wrap gap-2">
          {SUPPORTED_LOCALES.map((entry) => (
            <Chip
              key={entry.code}
              emoji={entry.flag}
              selected={locale === entry.code}
              onClick={() => setLocale(entry.code as Locale)}
            >
              {entry.label}
              {!entry.complete ? (
                <span className="ml-1 text-[0.7rem] opacity-60">bald</span>
              ) : null}
            </Chip>
          ))}
        </div>
        <p className="text-[0.76rem] text-ink-faint">
          Französisch, Spanisch, Italienisch und Türkisch sind vorbereitet, aber noch nicht
          übersetzt – sie zeigen vorerst Deutsch.
        </p>
      </section>

      {/* Datenschutz */}
      <section className="space-y-3">
        <h2 className="text-[0.95rem] font-bold tracking-tight">{t.profile.privacy}</h2>

        <div className="space-y-2.5 rounded-3xl bg-canvas-raised p-4 shadow-card hairline">
          <Row label="Gespeicherter Ort" value={location ? location.label : 'keiner'} />
          <Row
            label="Standortquelle"
            value={location?.fromDevice ? 'Gerätestandort' : location ? 'manuell gewählt' : '–'}
          />
          <Row
            label="Gemerkte Orte"
            value={`${prefs?.recentPlaceIds.length ?? 0}`}
          />
          <Row
            label="Preis-Empfindlichkeit"
            value={`${Math.round((prefs?.priceSensitivity ?? 0.5) * 100)} %`}
          />
          <Row
            label="Entfernungs-Empfindlichkeit"
            value={`${Math.round((prefs?.distanceSensitivity ?? 0.5) * 100)} %`}
          />
        </div>

        <p className="text-[0.8rem] leading-relaxed text-ink-muted">
          {t.profile.storedLocally} Es gibt kein Konto, keinen Server-Abgleich und keine
          Weitergabe an Dritte. Dein Standort wird nur für die aktuelle Suche verwendet.
        </p>

        <Button
          variant="secondary"
          full
          onClick={() => {
            clearEverything();
            setPrefs(loadPreferences());
            setLocation(null);
            setCleared(true);
            setTimeout(() => setCleared(false), 2200);
          }}
        >
          {cleared ? t.profile.cleared : t.profile.clear}
        </Button>
      </section>

      <p className="pb-4 text-center text-[0.74rem] text-ink-faint">
        WasJetzt · Mehr erleben. Weniger planen.
      </p>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[0.88rem]">
      <span className="text-ink-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
