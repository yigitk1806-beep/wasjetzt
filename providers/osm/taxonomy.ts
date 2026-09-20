import type { ProfileKey } from '@/providers/activityProfiles';

export type OsmTags = Record<string, string>;

/**
 * Übersetzt OSM-Tags in ein Aktivitätsprofil.
 * Gibt `null` zurück, wenn der Ort für WasJetzt nicht taugt – dann fliegt
 * er raus, statt in eine unpassende Kategorie gepresst zu werden.
 */
export function classify(tags: OsmTags): ProfileKey | null {
  const amenity = tags.amenity;
  const leisure = tags.leisure;
  const tourism = tags.tourism;
  const shop = tags.shop;

  if (amenity) {
    switch (amenity) {
      case 'restaurant':
        return restaurantKind(tags);
      case 'fast_food':
        return 'fastfood';
      case 'cafe':
        return tags.cuisine === 'ice_cream' ? 'icecream' : 'cafe';
      case 'ice_cream':
        return 'icecream';
      case 'bar':
        return 'bar';
      case 'pub':
        return 'pub';
      case 'biergarten':
        return 'biergarten';
      case 'nightclub':
        return 'nightclub';
      case 'cinema':
        return 'cinema';
      case 'theatre':
        return 'theatre';
      case 'arts_centre':
        return 'gallery';
      case 'casino':
        return 'casino';
      case 'marketplace':
        return 'market';
      case 'public_bath':
        return 'spa';
      default:
        break;
    }
  }

  if (leisure) {
    switch (leisure) {
      case 'park':
        return 'park';
      case 'garden':
        return 'garden';
      case 'nature_reserve':
        return 'nature_reserve';
      case 'bowling_alley':
        return 'bowling';
      case 'escape_game':
        return 'escape';
      case 'miniature_golf':
        return 'minigolf';
      case 'amusement_arcade':
      case 'adult_gaming_centre':
        return 'arcade';
      case 'water_park':
        return 'waterpark';
      case 'swimming_pool':
        return 'pool';
      case 'ice_rink':
        return 'icerink';
      case 'dance':
        return 'dance';
      case 'beach_resort':
        return 'beach';
      case 'sports_centre':
      case 'fitness_centre':
        return sportKind(tags);
      default:
        break;
    }
  }

  if (tourism) {
    switch (tourism) {
      case 'museum':
        return 'museum';
      case 'gallery':
        return 'gallery';
      case 'viewpoint':
        return 'viewpoint';
      case 'zoo':
        return 'zoo';
      case 'aquarium':
        return 'aquarium';
      case 'theme_park':
        return 'themepark';
      case 'attraction':
      case 'artwork':
        return 'attraction';
      default:
        break;
    }
  }

  if (shop === 'mall' || shop === 'department_store') return 'mall';
  if (tags.natural === 'beach') return 'beach';
  if (tags.sport === 'climbing') return 'climbing';

  return null;
}

/** Feinere Einordnung von Restaurants über `cuisine`. */
function restaurantKind(tags: OsmTags): ProfileKey {
  const cuisine = (tags.cuisine ?? '').toLowerCase();

  if (/pizza/.test(cuisine)) return 'pizza';
  if (/italian/.test(cuisine)) return 'italian';
  if (/burger|american|steak_house/.test(cuisine)) return 'burger';
  if (/chinese|japanese|sushi|thai|vietnamese|korean|asian|indian|ramen/.test(cuisine)) {
    return 'asian';
  }
  if (/kebab|doner|falafel|fish_and_chips/.test(cuisine)) return 'fastfood';
  if (tags['restaurant'] === 'fine_dining' || tags.stars) return 'fine_dining';

  return 'restaurant';
}

function sportKind(tags: OsmTags): ProfileKey {
  const sport = (tags.sport ?? '').toLowerCase();
  if (/climbing|bouldering/.test(sport)) return 'climbing';
  if (/swimming/.test(sport)) return 'pool';
  if (/ice_skating|ice_hockey/.test(sport)) return 'icerink';
  if (/bowling|10pin/.test(sport)) return 'bowling';
  return 'sportscentre';
}

/**
 * Overpass-Abfrage für alles, was WasJetzt gebrauchen kann.
 *
 * Bewusst über `[bbox:…]` statt `(around:…)`: Auf den öffentlichen Instanzen
 * ist ein `around`-Filter in Verbindung mit Tag-Filtern dramatisch langsamer
 * (gemessen ~37 s gegenüber ~0,8 s für dieselbe Menge). Die exakte
 * Entfernungsprüfung passiert danach bei uns – das Ergebnis ist identisch,
 * nur eben schnell genug für „Jetzt los".
 *
 * `nwr` deckt Nodes, Ways und Relations ab; `out center` liefert für Flächen
 * einen Mittelpunkt, damit wir überall mit Koordinaten rechnen können.
 */
export function buildOverpassQuery(
  lat: number,
  lon: number,
  radiusMeters: number,
  limit = 700,
): string {
  const dLat = radiusMeters / 111_320;
  const dLon = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);

  const bbox = [
    (lat - dLat).toFixed(5),
    (lon - dLon).toFixed(5),
    (lat + dLat).toFixed(5),
    (lon + dLon).toFixed(5),
  ].join(',');

  const filters = [
    'nwr["amenity"~"^(restaurant|cafe|fast_food|ice_cream|bar|pub|biergarten|nightclub|cinema|theatre|arts_centre|casino|marketplace|public_bath)$"]["name"];',
    'nwr["leisure"~"^(park|garden|nature_reserve|bowling_alley|escape_game|miniature_golf|amusement_arcade|adult_gaming_centre|water_park|swimming_pool|ice_rink|dance|beach_resort|sports_centre|fitness_centre)$"]["name"];',
    'nwr["tourism"~"^(museum|gallery|viewpoint|zoo|aquarium|theme_park|attraction)$"]["name"];',
    'nwr["shop"~"^(mall|department_store)$"]["name"];',
    'nwr["sport"="climbing"]["name"];',
  ].join('\n  ');

  return `[out:json][timeout:25][bbox:${bbox}];\n(\n  ${filters}\n);\nout center qt ${limit};`;
}
