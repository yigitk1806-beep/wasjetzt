import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, dictionaryFor, isLocale, negotiateLocale, type Locale } from './index';

/**
 * Sprache für Server-Komponenten: gewählte Sprache aus dem Cookie, sonst die
 * Sprache des Browsers (Accept-Language). `chosen` sagt, ob gewählt wurde.
 */
export async function requestLocale(): Promise<{ locale: Locale; chosen: boolean }> {
  const cookieStore = await cookies();
  const gespeichert = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(gespeichert)) return { locale: gespeichert, chosen: true };
  const headerStore = await headers();
  return { locale: negotiateLocale(headerStore.get('accept-language')), chosen: false };
}

export async function requestDictionary() {
  const { locale } = await requestLocale();
  return dictionaryFor(locale);
}
