'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Spinner } from '@/components/ui/Button';
import { useLocale } from '@/components/LocaleProvider';
import { loadHome, saveHome, type StoredHome } from '@/lib/clientStore';
import type { Coordinates } from '@/types/domain';

const MapPicker = dynamic(() => import('./MapPicker').then((m) => m.MapPicker), {
  ssr: false,
  loading: () => <div className="skeleton h-64 rounded-3xl" />,
});

type GeoResult = {
  label: string;
  location: Coordinates;
  country?: string;
  admin?: string;
  detail?: string;
  precise?: boolean;
};

/** Ein gewählter Startpunkt – Text und echte Koordinaten gehören zusammen. */
export type StartPoint = {
  label: string;
  location: Coordinates;
  fromDevice: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (start: StartPoint) => void;
  /** GPS anfragen; liefert den Standort zurück, wenn der Nutzer zustimmt. */
  onUseDevice: () => Promise<{ label: string; location: Coordinates } | null>;
  /** Aktueller Bezugspunkt – Treffer in der Nähe kommen zuerst. */
  near?: Coordinates | null;
};

/**
 * Woher es losgeht – die eine Stelle, an der der Startpunkt gewählt wird.
 * Vier Wege, wie man es von Karten-Apps kennt: aktueller Standort, Zuhause,
 * Adresssuche, Punkt auf der Karte. Jede Auswahl liefert echte Koordinaten;
 * ein Text allein wird nie zum Startpunkt.
 */
export function StartPointSheet({ open, onClose, onPick, onUseDevice, near }: Props) {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [home, setHome] = useState<StoredHome | null>(null);
  const [homeHinweis, setHomeHinweis] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setMapOpen(false);
      setHomeHinweis(false);
      return;
    }
    setHome(loadHome());
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const url = new URL('/api/geocode', window.location.origin);
      url.searchParams.set('q', query);
      url.searchParams.set('locale', locale);
      if (near) {
        url.searchParams.set('lat', String(near.lat));
        url.searchParams.set('lon', String(near.lon));
      }
      fetch(url, { signal: controller.signal })
        .then((res) => res.json())
        .then((data) => setResults(data.results ?? []))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 280);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, locale, near?.lat, near?.lon]);

  function waehlen(start: StartPoint) {
    onPick(start);
    onClose();
  }

  async function gps() {
    setLocating(true);
    const ergebnis = await onUseDevice();
    setLocating(false);
    if (ergebnis) waehlen({ label: ergebnis.label, location: ergebnis.location, fromDevice: true });
    else onClose();
  }

  const zuletztGesucht = results[0];

  return (
    <Sheet open={open} onClose={onClose} title={t.start.title}>
      {mapOpen ? (
        <MapPicker
          center={near ?? zuletztGesucht?.location ?? { lat: 52.52, lon: 13.405 }}
          onConfirm={(at, label) =>
            waehlen({ label: label ?? t.start.mapPicked, location: at, fromDevice: false })
          }
        />
      ) : (
        <div className="space-y-2.5">
          <Wahl
            emoji="📍"
            title={t.start.device}
            hint={t.start.deviceHint}
            busy={locating}
            onClick={() => void gps()}
          />

          {home ? (
            <Wahl
              emoji="🏠"
              title={t.start.home}
              hint={home.label || t.start.homeHint}
              onClick={() => waehlen({ label: home.label, location: home.location, fromDevice: false })}
            />
          ) : (
            <Wahl
              emoji="🏠"
              title={t.start.homeSet}
              hint={t.start.address}
              onClick={() => {
                setHomeHinweis(true);
                inputRef.current?.focus();
              }}
            />
          )}

          <Wahl emoji="📌" title={t.start.map} hint={t.start.mapHint} onClick={() => setMapOpen(true)} />

          <div className="pt-1.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.start.addressPlaceholder}
              aria-label={t.start.address}
              className="w-full rounded-2xl bg-canvas-sunk px-4 py-3.5 text-base outline-none ring-brand-300 placeholder:text-ink-faint focus:ring-2"
              autoComplete="off"
              enterKeyHint="search"
            />
            {homeHinweis ? (
              <p className="px-1 pt-1.5 text-[0.78rem] text-ink-muted">{t.start.saveHome}</p>
            ) : null}
          </div>

          {loading && results.length === 0 ? (
            <div className="space-y-2 pt-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-14 rounded-2xl" />
              ))}
            </div>
          ) : null}

          {!loading && query.trim().length >= 2 && results.length === 0 ? (
            <p className="px-1 py-2 text-[0.85rem] text-ink-muted">{t.start.noResults}</p>
          ) : null}

          <ul className="divide-y divide-line">
            {results.map((result) => {
              const zeile = [result.detail, result.admin, result.country]
                .filter(Boolean)
                .slice(0, 2)
                .join(' · ');
              const voll = result.detail ? `${result.label}, ${result.detail}` : result.label;
              return (
                <li key={`${result.label}-${result.location.lat}-${result.location.lon}`}>
                  <div className="flex items-center gap-2 py-2.5">
                    <button
                      type="button"
                      className="tap flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() =>
                        waehlen({ label: voll, location: result.location, fromDevice: false })
                      }
                    >
                      <span aria-hidden className="text-base">
                        {result.precise ? '🏠' : '🏙️'}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{result.label}</span>
                        {zeile ? (
                          <span className="block truncate text-sm text-ink-muted">{zeile}</span>
                        ) : null}
                      </span>
                    </button>
                    {homeHinweis ? (
                      <button
                        type="button"
                        className="tap shrink-0 rounded-xl bg-canvas-sunk px-3 py-1.5 text-[0.76rem] font-semibold text-ink-soft"
                        onClick={() => {
                          saveHome(voll, result.location);
                          setHome({ label: voll, location: result.location });
                          setHomeHinweis(false);
                          waehlen({ label: voll, location: result.location, fromDevice: false });
                        }}
                      >
                        🏠
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

function Wahl({
  emoji,
  title,
  hint,
  busy = false,
  onClick,
}: {
  emoji: string;
  title: string;
  hint: string;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="tap flex w-full items-center gap-3 rounded-2xl bg-canvas-sunk px-4 py-3 text-left disabled:opacity-60"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-canvas-raised text-lg" aria-hidden>
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.95rem] font-semibold">{title}</span>
        <span className="block truncate text-[0.8rem] text-ink-muted">{hint}</span>
      </span>
      {busy ? <Spinner className="text-ink-faint" /> : null}
    </button>
  );
}
