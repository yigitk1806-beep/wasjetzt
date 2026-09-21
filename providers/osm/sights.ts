import type { Category, IndoorOutdoor, SightTheme } from '@/types/domain';
import type { OsmTags } from './taxonomy';

/**
 * Sehenswürdigkeiten aus OpenStreetMap.
 *
 * Nichts hier ist eine Liste bekannter Orte. Alles wird aus den Tags
 * abgeleitet, die OSM-Mitwirkende an einen Ort gehängt haben – so
 * funktioniert es in jeder Stadt gleich, ohne Sonderfall für irgendeine.
 */

export type SightProfile = {
  category: Category;
  kind: string;
  emoji: string;
  /** Wie lange man typischerweise bleibt, in Minuten. */
  dwellMin: number;
  indoorOutdoor: IndoorOutdoor;
  /** Themen, die diese Art von Ort grundsätzlich bedient. */
  themes: SightTheme[];
  /** Braucht Tageslicht, um etwas zu sehen (Aussicht, Park …). */
  needsDaylight: boolean;
};

const P = (p: SightProfile) => p;

const PROFILES = {
  museum: P({ category: 'culture', kind: 'Museum', emoji: '🏛️', dwellMin: 75, indoorOutdoor: 'indoor', themes: ['museum', 'history'], needsDaylight: false }),
  gallery: P({ category: 'culture', kind: 'Galerie', emoji: '🖼️', dwellMin: 45, indoorOutdoor: 'indoor', themes: ['museum'], needsDaylight: false }),
  castle: P({ category: 'culture', kind: 'Schloss', emoji: '🏰', dwellMin: 60, indoorOutdoor: 'mixed', themes: ['history', 'photo'], needsDaylight: true }),
  palace: P({ category: 'culture', kind: 'Palast', emoji: '🏰', dwellMin: 60, indoorOutdoor: 'mixed', themes: ['history', 'photo'], needsDaylight: true }),
  church: P({ category: 'culture', kind: 'Kirche', emoji: '⛪', dwellMin: 25, indoorOutdoor: 'indoor', themes: ['history'], needsDaylight: false }),
  cathedral: P({ category: 'culture', kind: 'Dom', emoji: '⛪', dwellMin: 35, indoorOutdoor: 'indoor', themes: ['history', 'photo'], needsDaylight: false }),
  monument: P({ category: 'culture', kind: 'Denkmal', emoji: '🗿', dwellMin: 15, indoorOutdoor: 'outdoor', themes: ['history', 'photo'], needsDaylight: true }),
  memorial: P({ category: 'culture', kind: 'Gedenkort', emoji: '🕯️', dwellMin: 20, indoorOutdoor: 'outdoor', themes: ['history'], needsDaylight: true }),
  gate: P({ category: 'culture', kind: 'Stadttor', emoji: '🏛️', dwellMin: 15, indoorOutdoor: 'outdoor', themes: ['history', 'photo'], needsDaylight: true }),
  ruins: P({ category: 'culture', kind: 'Ruine', emoji: '🏚️', dwellMin: 25, indoorOutdoor: 'outdoor', themes: ['history', 'photo'], needsDaylight: true }),
  building: P({ category: 'culture', kind: 'Historisches Gebäude', emoji: '🏛️', dwellMin: 20, indoorOutdoor: 'outdoor', themes: ['history', 'photo'], needsDaylight: true }),
  ship: P({ category: 'culture', kind: 'Museumsschiff', emoji: '⚓', dwellMin: 45, indoorOutdoor: 'mixed', themes: ['history', 'museum', 'photo'], needsDaylight: false }),
  tower: P({ category: 'culture', kind: 'Turm', emoji: '🗼', dwellMin: 30, indoorOutdoor: 'mixed', themes: ['photo'], needsDaylight: true }),
  lighthouse: P({ category: 'culture', kind: 'Leuchtturm', emoji: '🗼', dwellMin: 20, indoorOutdoor: 'outdoor', themes: ['photo'], needsDaylight: true }),
  bridge: P({ category: 'culture', kind: 'Brücke', emoji: '🌉', dwellMin: 10, indoorOutdoor: 'outdoor', themes: ['photo'], needsDaylight: true }),
  viewpoint: P({ category: 'nature', kind: 'Aussichtspunkt', emoji: '🌅', dwellMin: 20, indoorOutdoor: 'outdoor', themes: ['photo', 'park'], needsDaylight: true }),
  artwork: P({ category: 'culture', kind: 'Kunstwerk', emoji: '🎨', dwellMin: 10, indoorOutdoor: 'outdoor', themes: ['photo'], needsDaylight: true }),
  fountain: P({ category: 'culture', kind: 'Brunnen', emoji: '⛲', dwellMin: 10, indoorOutdoor: 'outdoor', themes: ['photo'], needsDaylight: true }),
  park: P({ category: 'nature', kind: 'Park', emoji: '🌳', dwellMin: 35, indoorOutdoor: 'outdoor', themes: ['park'], needsDaylight: true }),
  garden: P({ category: 'nature', kind: 'Garten', emoji: '🌷', dwellMin: 35, indoorOutdoor: 'outdoor', themes: ['park', 'photo'], needsDaylight: true }),
  zoo: P({ category: 'activity', kind: 'Zoo', emoji: '🦁', dwellMin: 120, indoorOutdoor: 'outdoor', themes: ['park'], needsDaylight: true }),
  attraction: P({ category: 'culture', kind: 'Sehenswürdigkeit', emoji: '📍', dwellMin: 25, indoorOutdoor: 'mixed', themes: ['photo'], needsDaylight: false }),
} as const;

export type SightKey = keyof typeof PROFILES;

export function sightProfile(key: SightKey): SightProfile {
  return PROFILES[key];
}

/**
 * Ist dieser Ort bekannt? Echtes Signal statt Bauchgefühl: Es gibt einen
 * Wikipedia-Artikel dazu.
 *
 * Bewusst nicht Wikidata allein: Stolpersteine und Gedenktafeln haben fast alle
 * einen Wikidata-Eintrag, in Berlin sind es Tausende. Mit Wikidata als Signal
 * würden sie die großen Sehenswürdigkeiten verdrängen.
 */
export function isNotable(tags: OsmTags): boolean {
  if (tags.wikipedia) return true;
  return Object.keys(tags).some((key) => key.startsWith('wikipedia:'));
}

/** Gedenkformen, die keine Tourstation sind, so wichtig sie sind. */
const KLEINE_GEDENKFORMEN = /^(stolperstein|plaque|stele|stone|bench|ghost_bike|blue_plaque)$/;

/**
 * Ordnet einen OSM-Ort einer Art von Sehenswürdigkeit zu.
 * `null`, wenn er als Besichtigungsziel nichts taugt.
 */
export function classifySight(tags: OsmTags): SightKey | null {
  const tourism = tags.tourism;
  const historic = tags.historic;
  const notable = isNotable(tags);

  if (tourism === 'museum') return tags.historic === 'ship' ? 'ship' : 'museum';
  if (tourism === 'gallery') return 'gallery';
  if (tourism === 'viewpoint') return 'viewpoint';
  if (tourism === 'zoo' || tourism === 'aquarium') return 'zoo';
  // Kunst im öffentlichen Raum gibt es tausendfach – nur bekannte aufnehmen.
  if (tourism === 'artwork') return notable ? 'artwork' : null;

  if (historic) {
    switch (historic) {
      case 'castle':
        return tags.castle_type === 'palace' ? 'palace' : 'castle';
      case 'palace':
        return 'palace';
      case 'monument':
        return 'monument';
      case 'memorial':
        if (KLEINE_GEDENKFORMEN.test(tags.memorial ?? '')) return null;
        return notable || tags.memorial === 'monument' ? 'memorial' : null;
      case 'city_gate':
        return 'gate';
      case 'ruins':
      case 'archaeological_site':
      case 'fort':
        return 'ruins';
      case 'ship':
        return 'ship';
      case 'tower':
        return 'tower';
      case 'church':
      case 'cathedral':
        return historic === 'cathedral' ? 'cathedral' : 'church';
      case 'building':
      case 'manor':
        return notable ? 'building' : null;
      default:
        break;
    }
  }

  // Kirchen gibt es in jeder Straße – als Tourstation nur die bekannten.
  if (tags.amenity === 'place_of_worship' && notable) {
    return tags.building === 'cathedral' || /dom|kathedrale|münster|cathedral/i.test(tags.name ?? '')
      ? 'cathedral'
      : 'church';
  }

  if (tags.man_made === 'lighthouse') return 'lighthouse';
  if (tags.man_made === 'tower' && notable) return 'tower';
  if (tags.man_made === 'bridge' && notable) return 'bridge';
  if (tags.amenity === 'fountain' && notable) return 'fountain';

  // Parks nur, wenn sie bekannt genug sind – sonst wird jede Grünfläche zum Ziel.
  if (tags.leisure === 'park' && notable) return 'park';
  if (tags.leisure === 'garden' && notable) return 'garden';

  if (tourism === 'attraction') return 'attraction';

  return null;
}

/** Themen eines konkreten Ortes: die seiner Art plus Klassiker oder Geheimtipp. */
export function themesFor(key: SightKey, tags: OsmTags): SightTheme[] {
  const themes = new Set<SightTheme>(PROFILES[key].themes);
  themes.add(isNotable(tags) ? 'classic' : 'hidden');
  return [...themes];
}

/**
 * Overpass-Abfrage für Sehenswürdigkeiten – wie die Ortsabfrage über eine
 * bbox, weil `around` auf den öffentlichen Instanzen zu langsam ist.
 *
 * Tags, die es massenhaft gibt (Kirchen, Parks, Brücken), werden schon hier
 * auf bekannte Orte eingegrenzt. Das hält das Ergebnis klein und relevant.
 */
export function buildSightsQuery(
  lat: number,
  lon: number,
  radiusMeters: number,
  limit = 700,
): string {
  const dLat = radiusMeters / 111_320;
  const dLon = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon]
    .map((v) => v.toFixed(5))
    .join(',');

  // Nur Orte mit Wikipedia-Artikel – die Klassiker einer Stadt.
  //
  // Bewusst schlicht: Schlüssel prüfen statt Wertelisten per Regex. In Berlin
  // lief die ausführliche Variante gegen die Zeitgrenze der öffentlichen
  // Instanz (504) oder füllte das Limit mit Kleinzielen, sodass Brandenburger
  // Tor und Reichstag abgeschnitten wurden. Welche Art von Ort als Tourstation
  // taugt, entscheidet danach `classifySight` – Hotels, Stolpersteine und
  // Ähnliches fallen dort heraus.
  //
  // Geheimtipps kommen nicht von hier, sondern aus der normalen Ortsabfrage
  // (Museen, Galerien, Aussichtspunkte ohne Artikel). Das spart eine Anfrage.
  const bekannt = [
    'nwr["tourism"]["wikipedia"]["name"];',
    'nwr["historic"]["wikipedia"]["name"];',
    'nwr["amenity"~"^(place_of_worship|fountain)$"]["wikipedia"]["name"];',
    'nwr["man_made"~"^(tower|lighthouse|bridge)$"]["wikipedia"]["name"];',
    'nwr["leisure"~"^(park|garden)$"]["wikipedia"]["name"];',
  ].join('\n  ');

  return `[out:json][timeout:25][bbox:${bbox}];\n(\n  ${bekannt}\n);\nout center qt ${limit};`;
}
