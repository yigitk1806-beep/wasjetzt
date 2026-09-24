import { haversineMeters } from '@/lib/geo';
import type { GeocodeResult, GeocodingProvider } from '@/providers/types';
import type { Coordinates } from '@/types/domain';

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    district?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    type?: string;
    osm_key?: string;
    osm_value?: string;
  };
};

type PhotonResponse = { features?: PhotonFeature[] };

const BASIS = 'https://photon.komoot.io';
/** Photon übersetzt Namen nur in diese Sprachen; alles andere bekommt Englisch. */
const SPRACHEN = new Set(['de', 'en', 'fr', 'it']);
const MAX_TREFFER = 6;
const CACHE_MAX = 200;
const CACHE_MS = 10 * 60_000;

const cache = new Map<string, { at: number; results: GeocodeResult[] }>();

/**
 * Adresssuche über Photon – dieselben OpenStreetMap-Daten wie der Rest der App,
 * aber ein Dienst, der auf Tippsuche ausgelegt ist.
 *
 * Liefert echte Koordinaten einer Hausnummer, nicht nur den Ortsmittelpunkt:
 * „Müllerstraße 120 Berlin" endet damit wirklich vor dem Haus, und genau diese
 * Koordinaten gehen anschließend in Ortssuche, Entfernung, Routing und Karte.
 * Nichts wird geraten – kennt Photon die Adresse nicht, gibt es keinen Treffer.
 */
export class PhotonGeocodingProvider implements GeocodingProvider {
  readonly id = 'photon';

  async search(query: string, locale = 'de', near?: Coordinates): Promise<GeocodeResult[]> {
    const q = query.trim();
    if (q.length < 2) return [];

    const sprache = sprachCode(locale);
    const key = `${sprache}:${q.toLowerCase()}:${zelle(near)}`;
    const treffer = ausCache(key);
    if (treffer) return treffer;

    try {
      const url = new URL('/api/', BASIS);
      url.searchParams.set('q', q);
      url.searchParams.set('limit', String(MAX_TREFFER * 2));
      url.searchParams.set('lang', sprache);
      // Näher am Nutzer zuerst: „Hauptstraße 5" meint fast immer die in der Nähe.
      if (near) {
        url.searchParams.set('lat', near.lat.toFixed(4));
        url.searchParams.set('lon', near.lon.toFixed(4));
      }

      // Steht eine Ziffer in der Eingabe, ist eine Adresse gemeint – dann
      // gehört die Adresse in die Überschrift und nicht der Name des Lokals,
      // das zufällig dort sitzt.
      const results = umwandeln(await hole<PhotonResponse>(url), sprache, /\d/.test(q));
      inCache(key, results);
      return results;
    } catch {
      return [];
    }
  }

  /** Für „auf der Karte wählen": echte Adresse zum angetippten Punkt. */
  async reverse(at: Coordinates, locale = 'de'): Promise<GeocodeResult | null> {
    try {
      const url = new URL('/reverse', BASIS);
      url.searchParams.set('lat', String(at.lat));
      url.searchParams.set('lon', String(at.lon));
      url.searchParams.set('limit', '1');
      url.searchParams.set('lang', sprachCode(locale));

      const results = umwandeln(await hole<PhotonResponse>(url), sprachCode(locale));
      // Die Koordinaten des Nutzers zählen, nicht die des gefundenen Hauses –
      // gesucht wird nur der Name für den Punkt, den er gewählt hat.
      return results[0] ? { ...results[0], location: at } : null;
    } catch {
      return null;
    }
  }
}

async function hole<T>(url: URL): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(4000),
    headers: { 'User-Agent': 'WasJetzt/1.0 (https://wasjetzt-three.vercel.app)' },
  });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  return (await res.json()) as T;
}

function sprachCode(locale: string): string {
  const kurz = locale.slice(0, 2).toLowerCase();
  return SPRACHEN.has(kurz) ? kurz : 'en';
}

function zelle(near?: Coordinates): string {
  if (!near) return '-';
  return `${near.lat.toFixed(2)},${near.lon.toFixed(2)}`;
}

function ausCache(key: string): GeocodeResult[] | null {
  const eintrag = cache.get(key);
  if (!eintrag) return null;
  if (Date.now() - eintrag.at > CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return eintrag.results;
}

function inCache(key: string, results: GeocodeResult[]) {
  if (cache.size >= CACHE_MAX) {
    const aeltester = cache.keys().next().value;
    if (aeltester) cache.delete(aeltester);
  }
  cache.set(key, { at: Date.now(), results });
}

/** Treffer, die praktisch am selben Fleck liegen, sind für einen Startpunkt derselbe. */
const GLEICHER_ORT_M = 60;

function umwandeln(json: PhotonResponse, sprache: string, adresssuche = false): GeocodeResult[] {
  const raus: GeocodeResult[] = [];

  for (const feature of json.features ?? []) {
    const p = feature.properties;
    const koordinaten = feature.geometry?.coordinates;
    if (!p || !koordinaten || koordinaten.length < 2) continue;

    const label = beschriftung(p, sprache, adresssuche);
    if (!label) continue;

    const location = { lat: koordinaten[1], lon: koordinaten[0] };
    // Vier Lokale im selben Haus sind vier Zeilen für denselben Startpunkt.
    if (raus.some((r) => haversineMeters(r.location, location) < GLEICHER_ORT_M)) continue;

    const detail = zweiteZeile(p, sprache, adresssuche);
    raus.push({
      label,
      location,
      country: p.country,
      admin: p.state,
      detail: detail || undefined,
      precise: Boolean(p.housenumber) || p.type === 'house',
    });
    if (raus.length >= MAX_TREFFER) break;
  }

  return raus;
}

/**
 * Erste Zeile: Ein benannter Ort heißt nach seinem Namen („Brandenburger
 * Tor"), eine reine Adresse nach Straße und Hausnummer. Wer eine Adresse
 * eingetippt hat, bekommt auch die Adresse zu lesen.
 */
function beschriftung(
  p: NonNullable<PhotonFeature['properties']>,
  sprache: string,
  adresssuche: boolean,
): string | null {
  if (adresssuche) return adresse(p, sprache) ?? p.name ?? null;
  if (p.name && p.name !== p.street) return p.name;
  return adresse(p, sprache) ?? p.name ?? null;
}

/** Zweite Zeile: Adresse und Ort – nur, was die Quelle wirklich liefert. */
function zweiteZeile(
  p: NonNullable<PhotonFeature['properties']>,
  sprache: string,
  adresssuche: boolean,
): string {
  const ort = [p.postcode, p.city ?? p.district ?? p.county ?? p.state].filter(Boolean).join(' ');
  const benannt = !adresssuche && Boolean(p.name && p.name !== p.street);
  const teile = benannt ? [adresse(p, sprache), ort] : [ort];
  return teile.filter(Boolean).join(', ') || p.country || '';
}

/** Englisch und Französisch schreiben die Hausnummer vor die Straße. */
const NUMMER_VORN = new Set(['en', 'fr']);

function adresse(
  p: NonNullable<PhotonFeature['properties']>,
  sprache: string,
): string | null {
  if (!p.street) return null;
  if (!p.housenumber) return p.street;
  return NUMMER_VORN.has(sprache)
    ? `${p.housenumber} ${p.street}`
    : `${p.street} ${p.housenumber}`;
}
