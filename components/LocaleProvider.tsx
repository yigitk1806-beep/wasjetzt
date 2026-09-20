'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, dictionaryFor, type Dictionary, type Locale } from '@/lib/i18n';
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

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const stored = loadPreferences().language as Locale;
    if (stored && stored !== locale) setLocaleState(stored);
    // Nur beim ersten Rendern – danach steuert der Nutzer die Sprache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    updatePreferences((prefs) => ({ ...prefs, language: next }));
    if (typeof document !== 'undefined') document.documentElement.lang = next;
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
