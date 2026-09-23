import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Kurzbeschreibung und Vorschaubild einer Sehenswürdigkeit aus Wikipedia.
 *
 * Die Verknüpfung stammt aus OpenStreetMap (Tag `wikipedia`), der Inhalt
 * direkt aus dem Artikel – nichts davon ist ausgedacht. Fehlt ein Bild,
 * bleibt es weg. Texte stehen unter CC BY-SA; die Oberfläche verlinkt
 * deshalb immer auf den Artikel.
 *
 * OSM verweist meist auf den Artikel in der Landessprache („fr:Tour Eiffel").
 * Gewünscht ist die Sprache des Nutzers (`lang`). Gibt es dort keinen Artikel,
 * kommt nur das Bild – ein fremdsprachiger Text mitten in einer sonst
 * englischen Oberfläche wäre schlechter als gar keiner.
 *
 * Aufruf: /api/wiki?t=de:Brandenburger%20Tor&lang=en
 */

type Summary = {
  extract?: string;
  thumbnail?: { source: string; width: number; height: number };
  originalimage?: { source: string; width: number; height: number };
  content_urls?: { mobile?: { page?: string }; desktop?: { page?: string } };
  type?: string;
};

type Antwort = {
  text: string | null;
  bild: string | null;
  link: string | null;
};

const LEER: Antwort = { text: null, bild: null, link: null };
const UNTERSTUETZT = ['de', 'en', 'fr', 'es', 'it', 'tr'];
const UA = { 'User-Agent': 'WasJetzt/0.1 (Freizeitplaner)' };

const cache = new Map<string, { at: number; data: Antwort }>();
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Nur Sprachkürzel sind erlaubt – der Wert landet im Hostnamen. Ohne diese
 * Prüfung könnte jemand die Anfrage an einen beliebigen Server umleiten.
 */
const SPRACHE = /^[a-z]{2,3}(-[a-z]{2,8})?$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const t = params.get('t') ?? '';
  const wunsch = params.get('lang') ?? 'de';
  const ziel = UNTERSTUETZT.includes(wunsch) ? wunsch : 'de';
  const trenner = t.indexOf(':');
  const lang = trenner > 0 ? t.slice(0, trenner) : '';
  const titel = trenner > 0 ? t.slice(trenner + 1).trim() : '';

  if (!SPRACHE.test(lang) || !titel || titel.length > 200) {
    return NextResponse.json({ error: 'Ungültiger Artikel.' }, { status: 400 });
  }

  const key = `${ziel}|${lang}:${titel}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return antworten(cached.data);

  try {
    let data: Antwort | null = null;

    if (lang === ziel) {
      data = await zusammenfassung(lang, titel);
    } else {
      const uebersetzt = await titelIn(lang, titel, ziel);
      if (uebersetzt) data = await zusammenfassung(ziel, uebersetzt);
      if (!data) {
        // Kein Artikel in der Sprache des Nutzers: Bild ja, fremder Text nein.
        const original = await zusammenfassung(lang, titel);
        data = original ? { text: null, bild: original.bild, link: original.link } : null;
      }
    }
    data = data ?? LEER;

    cache.set(key, { at: Date.now(), data });
    return antworten(data);
  } catch {
    return antworten(LEER);
  }
}

async function zusammenfassung(lang: string, titel: string): Promise<Antwort | null> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    titel.replace(/ /g, '_'),
  )}`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(4000) });
  if (!res.ok) return null;

  const json = (await res.json()) as Summary;
  // Begriffsklärungsseiten sind keine Beschreibung des Ortes.
  if (json.type === 'disambiguation') return null;

  return {
    text: ersteSaetze(json.extract ?? ''),
    bild: groesseresBild(json),
    link: json.content_urls?.mobile?.page ?? json.content_urls?.desktop?.page ?? null,
  };
}

/** Titel des Artikels zum selben Thema in der Zielsprache, falls es einen gibt. */
async function titelIn(lang: string, titel: string, ziel: string): Promise<string | null> {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.searchParams.set('action', 'query');
  url.searchParams.set('prop', 'langlinks');
  url.searchParams.set('lllang', ziel);
  url.searchParams.set('titles', titel);
  url.searchParams.set('redirects', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');

  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(3000) });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    query?: { pages?: Array<{ langlinks?: Array<{ title?: string }> }> };
  };
  return json.query?.pages?.[0]?.langlinks?.[0]?.title ?? null;
}

/**
 * Das Vorschaubild der API ist 330 Pixel breit – auf einem Handydisplay
 * unscharf. Wikimedia liefert feste Zwischengrößen; 500 Pixel reichen für
 * eine Karte in voller Breite und bleiben klein.
 */
function groesseresBild(json: Summary): string | null {
  const thumb = json.thumbnail?.source;
  if (!thumb) return null;
  // Ein Logo ist kein Eindruck vom Ort.
  if (/logo/i.test(thumb)) return null;
  const original = json.originalimage?.width ?? 0;
  if (original >= 500 && /\/330px-/.test(thumb)) return thumb.replace('/330px-', '/500px-');
  return thumb;
}

function antworten(data: Antwort) {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
  });
}

/**
 * Die ersten ein, zwei Sätze – genug für einen Eindruck, kein Artikel.
 *
 * Ein Punkt nach einer Zahl („im 18. Jahrhundert") oder einer Abkürzung
 * („St. Hedwig", „bzw.") beendet keinen Satz.
 */
const SATZENDE = /(?<![0-9])(?<!\b\p{L}{1,3})[.!?](?=\s+[\p{Lu}„"«]|$)/gu;

function ersteSaetze(text: string): string | null {
  const bereinigt = text.replace(/\s+/g, ' ').trim();
  if (!bereinigt) return null;
  if (bereinigt.length <= 240) return bereinigt;

  let ende = -1;
  for (const treffer of bereinigt.matchAll(SATZENDE)) {
    const pos = (treffer.index ?? 0) + 1;
    if (pos > 240) break;
    ende = pos;
  }
  if (ende >= 60) return bereinigt.slice(0, ende);

  const schnitt = bereinigt.slice(0, 220);
  return `${schnitt.slice(0, schnitt.lastIndexOf(' '))} …`;
}
