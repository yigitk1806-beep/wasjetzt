import { profileFor } from '@/providers/activityProfiles';
import type { Place, PriceInfo, PriceLevel } from '@/types/domain';
import { parseOpeningHours } from './openingHours';
import { classify, istGluecksspiel, type OsmTags } from './taxonomy';
import { classifySight, isNotable, sightProfile, themesFor } from './sights';

/**
 * OSM-Tags werden zu einem `Place`.
 *
 * Diese Datei stand urspruenglich im Overpass-Provider. Sie ist dort
 * herausgezogen, weil es inzwischen zwei Quellen fuer dieselben Daten gibt:
 * die Overpass-API und die eigene Ortsdatenbank aus Geofabrik-Auszuegen
 * (siehe `infra/osm-import/`). Beide speichern beziehungsweise liefern die
 * rohen Tags und lassen sie hier umwandeln.
 *
 * Das ist der ganze Zweck der Trennung: Es gibt genau eine Stelle, an der
 * aus Tags ein Ort wird. Eine Aenderung an der Klassifizierung, an den
 * Preisstufen oder an der Gluecksspielsperre wirkt damit zwangslaeufig auf
 * beide Quellen. Zwei Umwandlungen zu pflegen hiesse, dass sie
 * auseinanderlaufen - und dann waere ein Ort je nach Tagesform des
 * Overpass-Servers eine Spielhalle oder eben nicht.
 *
 * Der Nebeneffekt, der die Trennung ausgeloest hat: Der Overpass-Provider
 * benutzt Parameter-Eigenschaften im Konstruktor, und die kann Node beim
 * reinen Typ-Entfernen nicht verarbeiten. Die Importskripte und Tests
 * laufen ohne Uebersetzungsschritt - sie brauchen ein Modul, das sich
 * direkt laden laesst.
 */

/**
 * Ein Element, wie Overpass es liefert. Die eigene Datenbank baut diese
 * Form aus ihren Zeilen nach, damit es nur einen Weg in `toPlace` gibt.
 */
export type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: OsmTags;
};

export function toPlace(element: OverpassElement): Place | null {
  const tags = element.tags;
  if (!tags?.name) return null;

  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (lat === undefined || lon === undefined) return null;

  const profileKey = classify(tags);
  if (!profileKey) return null;
  const profile = profileFor(profileKey);

  // Dauerhaft geschlossene oder geplante Objekte überspringen.
  if (tags['disused:amenity'] || tags.abandoned || tags.construction) return null;
  if (tags.access === 'private' || tags.access === 'no') return null;

  return {
    id: `osm_${element.type[0]}${element.id}`,
    name: tags.name,
    category: profile.category,
    kind: profile.kind,
    emoji: profile.emoji,
    location: { lat, lon, address: addressOf(tags) },
    price: priceOf(tags, profile.priceLevel),
    typicalDurationMin: profile.typicalDurationMin,
    openingHours: parseOpeningHours(tags.opening_hours),
    indoorOutdoor: profile.indoorOutdoor,
    rainSuitability: profile.rainSuitability,
    heatSuitability: profile.heatSuitability,
    coldSuitability: profile.coldSuitability,
    bestSeasons: profile.bestSeasons,
    scores: { ...profile.scores },
    // OSM kennt keine Bewertungen – also gibt es hier auch keine.
    source: 'openstreetmap',
    // Für die Tourplanung: Orte ohne Wikipedia-Artikel werden zu Geheimtipps.
    notable: isNotable(tags),
    sightseeing: profile.sightseeing,
    // Profil ODER Tags: Ein Ort kann über ein harmloses Zweit-Tag in die
    // Abfrage geraten und trotzdem eine Spielhalle sein.
    gambling: profile.gambling || istGluecksspiel(tags),
    minAge: minAgeOf(tags, profile.minAge),
    bookable: profile.bookable,
  };
}

/**
 * Eine Sehenswürdigkeit aus OSM. Dieselben Regeln wie bei Ausgehorten:
 * Öffnungszeiten und Preise nur, wenn OSM sie liefert – sonst ehrlich leer.
 */
export function toSight(element: OverpassElement): Place | null {
  const tags = element.tags;
  if (!tags?.name) return null;

  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (lat === undefined || lon === undefined) return null;

  const key = classifySight(tags);
  if (!key) return null;
  if (tags['disused:tourism'] || tags.abandoned || tags.access === 'private') return null;

  const profile = sightProfile(key);
  const notable = isNotable(tags);

  // Die meisten Denkmäler, Brücken und Aussichtspunkte kosten nichts; Museen,
  // Schlösser, Türme und Attraktionen (Miniatur Wunderland, Fernsehturm …)
  // meist etwas. Das ist eine Schätzung und wird so ausgewiesen.
  const kostetMeist = ['museum', 'castle', 'palace', 'zoo', 'ship', 'tower', 'attraction'];
  const fallbackLevel = kostetMeist.includes(key) ? 1 : 0;

  return {
    id: `osm_${element.type[0]}${element.id}`,
    name: tags.name,
    category: profile.category,
    kind: profile.kind,
    emoji: profile.emoji,
    location: { lat, lon, address: addressOf(tags) },
    price: priceOf(tags, fallbackLevel),
    typicalDurationMin: profile.dwellMin,
    openingHours: parseOpeningHours(tags.opening_hours),
    indoorOutdoor: profile.indoorOutdoor,
    rainSuitability: profile.indoorOutdoor === 'indoor' ? 1 : profile.indoorOutdoor === 'mixed' ? 0.6 : 0.15,
    heatSuitability: profile.indoorOutdoor === 'indoor' ? 0.95 : 0.7,
    coldSuitability: profile.indoorOutdoor === 'indoor' ? 1 : 0.45,
    bestSeasons: [],
    scores: {
      romantic: profile.themes.includes('photo') ? 0.8 : 0.5,
      action: 0.2,
      family: 0.7,
      chill: profile.themes.includes('park') ? 0.9 : 0.6,
      // Unbekanntes ist neuer als das, was jeder schon gesehen hat.
      novelty: notable ? 0.5 : 0.85,
      social: 0.5,
    },
    source: 'openstreetmap',
    themes: themesFor(key, tags),
    notable,
    // Auch eine Sehenswürdigkeit kann eine Spielbank sein: Berühmte Häuser
    // tragen in OSM oft `tourism=attraction` neben `amenity=casino`. Ohne
    // dieses Kennzeichen käme so ein Ort über die Tour herein.
    gambling: istGluecksspiel(tags) || undefined,
    wikipedia: wikipediaOf(tags),
    prominence: prominenceOf(tags),
  };
}

/**
 * Bekanntheit aus echten Daten: In wie vielen Sprachen gibt es einen Namen
 * oder Wikipedia-Artikel? Weltbekannte Orte haben Dutzende, lokale kaum welche.
 */
function prominenceOf(tags: OsmTags): number {
  let sprachen = 0;
  for (const key of Object.keys(tags)) {
    if (/^(name|wikipedia):[a-z]{2,3}(-[A-Za-z]+)?$/.test(key)) sprachen += 1;
  }
  return Math.min(1, sprachen / 25);
}

/** "de:Brandenburger Tor" – bevorzugt der Haupteintrag, sonst ein Sprach-Tag. */
function wikipediaOf(tags: OsmTags): string | undefined {
  if (tags.wikipedia?.includes(':')) return tags.wikipedia;
  if (tags['wikipedia:de']) return `de:${tags['wikipedia:de']}`;
  const sprach = Object.keys(tags).find((k) => k.startsWith('wikipedia:'));
  return sprach ? `${sprach.slice('wikipedia:'.length)}:${tags[sprach]}` : undefined;
}

/** Preis: echter Betrag nur, wenn OSM ihn wirklich angibt. */
function priceOf(tags: OsmTags, fallbackLevel: PriceLevel): PriceInfo {
  if (tags.fee === 'no' || tags['fee:conditional']?.startsWith('no')) {
    return { level: 0, levelEstimated: false };
  }

  const charge = parseCharge(tags.charge ?? tags['fee:amount']);
  if (charge !== null) {
    return {
      level: levelFromAmount(charge),
      levelEstimated: false,
      perPerson: { min: charge, max: charge },
    };
  }

  return { level: fallbackLevel, levelEstimated: true };
}

/** Versteht nur eindeutige Angaben wie "5 EUR" oder "7.50 EUR". */
function parseCharge(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,4})(?:[.,](\d{1,2}))?\s*(eur|€)$/i);
  if (!match) return null;
  const amount = Number(`${match[1]}.${match[2] ?? '0'}`);
  return Number.isFinite(amount) ? amount : null;
}

function levelFromAmount(amount: number): PriceLevel {
  if (amount === 0) return 0;
  if (amount <= 12) return 1;
  if (amount <= 30) return 2;
  return 3;
}

function minAgeOf(tags: OsmTags, fallback: number | undefined): number | undefined {
  const raw = tags['min_age'] ?? tags['age:min'];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function addressOf(tags: OsmTags): string | undefined {
  const street = tags['addr:street'];
  if (!street) return undefined;
  const number = tags['addr:housenumber'];
  const strasse = number ? `${street} ${number}` : street;

  // Postleitzahl und Ort nur, wenn OSM sie wirklich hat – nichts ergänzen.
  const ort = [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' ');
  return ort ? `${strasse}, ${ort}` : strasse;
}

/**
 * OSM enthält denselben Betrieb gelegentlich mehrfach (Node + Gebäudefläche).
 * Gleicher Name in derselben ~100-m-Kachel wird zusammengefasst; der Eintrag
 * mit den meisten Angaben gewinnt.
 */
export function dedupe(places: Place[]): Place[] {
  const byKey = new Map<string, Place>();

  for (const place of places) {
    const key = [
      place.name.toLowerCase(),
      place.location.lat.toFixed(3),
      place.location.lon.toFixed(3),
    ].join('|');

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, place);
      continue;
    }
    if (!existing.openingHours && place.openingHours) byKey.set(key, place);
  }

  return [...byKey.values()];
}
