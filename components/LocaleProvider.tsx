'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  dictionaryFor,
  isLocale,
  type Dictionary,
  type Locale,
} from '@/lib/i18n';
import { loadPreferences, updatePreferences } from '@/lib/clientStore';

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: dictionaryFor(DEFAULT_LOCALE),
});

type Props = {
  children: ReactNode;
  /** Vom Server bestimmt: Cookie, sonst Sprache des Browsers. */
  initialLocale: Locale;
  /** Hat der Nutzer schon einmal selbst gewählt (Cookie vorhanden)? */
  chosen: boolean;
};

function merken(locale: Locale) {
  // Ein Jahr – damit die Wahl auch nach Reload und auf neuen Seiten gilt.
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
  updatePreferences((prefs) => ({ ...prefs, language: locale }));
}

/**
 * Sprache der ganzen App. Der Server rendert schon in der richtigen Sprache
 * (Cookie oder Browser-Sprache), deshalb gibt es kein kurzes Aufblitzen von
 * Deutsch. Eine manuelle Wahl gilt dauerhaft und hat Vorrang.
 */
export function LocaleProvider({ children, initialLocale, chosen }: Props) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    // Wer vor der Umstellung schon eine Sprache gewählt hatte, hat sie nur im
    // Browser-Speicher – einmal übernehmen und als Cookie sichern.
    if (chosen) return;
    const frueher = loadPreferences().language;
    if (isLocale(frueher) && frueher !== DEFAULT_LOCALE && frueher !== initialLocale) {
      setLocaleState(frueher);
      merken(frueher);
    }
    // Nur beim ersten Rendern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    merken(next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: dictionaryFor(locale) }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}
