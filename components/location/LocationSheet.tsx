'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useLocale } from '@/components/LocaleProvider';
import type { Coordinates } from '@/types/domain';

type GeoResult = {
  label: string;
  location: Coordinates;
  country?: string;
  admin?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (label: string, coords: Coordinates) => void;
  onUseDevice: () => void;
};

export function LocationSheet({ open, onClose, onPick, onUseDevice }: Props) {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 240);
    else {
      setQuery('');
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/geocode?q=${encodeURIComponent(query)}&locale=${locale}`, {
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data) => setResults(data.results ?? []))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 260);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, locale]);

  return (
    <Sheet open={open} onClose={onClose} title={t.location.choose}>
      <div className="space-y-3">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.location.search}
          className="w-full rounded-2xl bg-canvas-sunk px-4 py-3.5 text-base outline-none ring-brand-300 placeholder:text-ink-faint focus:ring-2"
          autoComplete="off"
          enterKeyHint="search"
        />

        <Button
          variant="secondary"
          full
          onClick={() => {
            onUseDevice();
            onClose();
          }}
          icon={<PinIcon />}
        >
          {t.location.useCurrent}
        </Button>

        {loading && results.length === 0 ? (
          <div className="space-y-2 pt-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-14 rounded-2xl" />
            ))}
          </div>
        ) : null}

        <ul className="divide-y divide-line">
          {results.map((result) => (
            <li key={`${result.label}-${result.location.lat}-${result.location.lon}`}>
              <button
                type="button"
                className="tap flex w-full items-center justify-between gap-3 py-3.5 text-left"
                onClick={() => {
                  onPick(result.label, result.location);
                  onClose();
                }}
              >
                <span>
                  <span className="block font-semibold">{result.label}</span>
                  <span className="block text-sm text-ink-muted">
                    {[result.admin, result.country].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <ChevronIcon />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 21s7-5.6 7-10.7A7 7 0 0 0 5 10.3C5 15.4 12 21 12 21Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10.2" r="2.4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="text-ink-faint">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
