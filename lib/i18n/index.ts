import { de, type Dictionary } from './locales/de';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { it } from './locales/it';
import { tr } from './locales/tr';

/**
 * Mehrsprachigkeit: sechs vollständig gepflegte Sprachen. Alle Texte der
 * Oberfläche – und alles, was der Server als Hinweis oder Begründung liefert –
 * laufen über diese Wörterbücher.
 */
export const SUPPORTED_LOCALES = [
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷' },
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number]['code'];

export const DEFAULT_LOCALE: Locale = 'de';

/** Cookie mit der gewählten Sprache – damit der Server gleich richtig rendert. */
export const LOCALE_COOKIE = 'wj_locale';

const DICTIONARIES: Record<Locale, Dictionary> = { de, en, fr, es, it, tr };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && value in DICTIONARIES;
}

export function dictionaryFor(locale: string | undefined | null): Dictionary {
  const short = (locale ?? '').slice(0, 2).toLowerCase();
  return isLocale(short) ? DICTIONARIES[short] : DICTIONARIES[DEFAULT_LOCALE];
}

/**
 * Sprache aus dem `Accept-Language`-Header des Browsers – beim ersten Besuch,
 * solange nichts gewählt ist. Ein iPhone auf Englisch startet also englisch.
 * Unbekannte Sprachen bekommen Englisch statt Deutsch: Wer weder Deutsch noch
 * eine der anderen Sprachen eingestellt hat, versteht Englisch eher.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const kandidaten = acceptLanguage
    .split(',')
    .map((teil) => {
      const [tag, ...rest] = teil.trim().split(';');
      const q = rest.find((r) => r.trim().startsWith('q='));
      return { code: tag.slice(0, 2).toLowerCase(), q: q ? Number(q.split('=')[1]) : 1 };
    })
    .filter((k) => k.code && Number.isFinite(k.q))
    .sort((a, b) => b.q - a.q);
  for (const kandidat of kandidaten) {
    if (isLocale(kandidat.code)) return kandidat.code;
  }
  return kandidaten.length ? 'en' : DEFAULT_LOCALE;
}

/** Aktuelle Sprache im Browser – der LocaleProvider hält `<html lang>` aktuell. */
export function currentLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const lang = document.documentElement.lang;
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}

export type { Dictionary };
