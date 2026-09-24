import type { ProfileKey } from '@/providers/activityProfiles';

export type OsmTags = Record<string, string>;

/**
 * Übersetzt OSM-Tags in ein Aktivitätsprofil.
 * Gibt `null` zurück, wenn der Ort für WasJetzt nicht taugt – dann fliegt
 * er raus, statt in eine unpassende Kategorie gepresst zu werden.
 */
/**
 * Infrastruktur, die nie eine Freizeitidee ist – auch dann nicht, wenn
 * zusätzlich ein brauchbares Tag daran hängt. In OSM trägt etwa ein
 * Bahnhofsgebäude gern `tourism=attraction`, ein Parkplatz `leisure=park`
 * als Tippfehler. Solche Treffer sollen gar nicht erst im Plan landen.
 */
function istInfrastruktur(tags: OsmTags): boolean {
  // Wege und Verkehr: `highway` deckt cycleway, footway, path, pedestrian,
  // residential, service und bus_stop mit ab – all das ist Untergrund fürs
  // Routing, aber niemals ein Vorschlag für den Abend.
  if (tags.highway || tags.railway || tags.public_transport || tags.aeroway) return true;
  // Relationen wie Rad- und Wanderrouten oder Buslinien.
  if (tags.route) return true;
  if (tags.amenity === 'parking' || tags.amenity === 'bicycle_parking') return true;
  if (tags.amenity === 'bus_station' || tags.amenity === 'taxi') return true;
  // Leitungen, Masten, Gewässerbauwerke, Schranken, Zäune.
  if (tags.power || tags.waterway || tags.barrier) return true;
  if (tags.man_made && tags.man_made !== 'tower') return true;
  // Reine Gebäude ohne eigene Nutzung.
  if (tags.building && !tags.amenity && !tags.leisure && !tags.tourism && !tags.shop) return true;
  return false;
}

export function classify(tags: OsmTags): ProfileKey | null {
  if (istInfrastruktur(tags)) return null;

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
      case 'trampoline_park':
        return 'trampoline';
      case 'bowling_centre':
        return 'bowling';
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
        return sportKind(tags);
      // Fitnessstudios brauchen eine Mitgliedschaft – keine spontane Idee.
      case 'fitness_centre':
        return null;
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
  // Erlebnisorte, die in OSM nur über `sport` oder `leisure=track` hängen –
  // Kartbahn, Lasertag, Kletterhalle, Paintball und Co.
  if (tags.sport || tags.leisure === 'track') return erlebnisSport(tags.sport);

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

/**
 * Nur Sportanlagen, in die man einfach hineingehen kann. Ein allgemeines
 * Sportzentrum ist meist ein Verein oder Studio mit Mitgliedschaft – das
 * fliegt raus, statt als Freizeitidee vorgeschlagen zu werden.
 */
function sportKind(tags: OsmTags): ProfileKey | null {
  return erlebnisSport(tags.sport);
}

/**
 * Sportarten, die man spontan zu zweit oder in der Gruppe machen kann –
 * ohne Mitgliedschaft, ohne Verein, ohne Anmeldung für die Saison.
 * Alles andere ist kein Freizeitvorschlag und fliegt raus.
 */
function erlebnisSport(wert: string | undefined): ProfileKey | null {
  const sport = (wert ?? '').toLowerCase();
  if (/climbing|bouldering/.test(sport)) return 'climbing';
  if (/swimming/.test(sport)) return 'pool';
  if (/ice_skating|ice_hockey/.test(sport)) return 'icerink';
  if (/bowling|10pin|9pin/.test(sport)) return 'bowling';
  if (/karting|motorsport/.test(sport)) return 'karting';
  if (/laser_?tag|lasergame/.test(sport)) return 'lasertag';
  if (/paintball|airsoft/.test(sport)) return 'paintball';
  if (/trampolin/.test(sport)) return 'trampoline';
  if (/axe_?throwing|knife_throwing/.test(sport)) return 'axethrowing';
  if (/billiards|snooker|darts/.test(sport)) return 'billiards';
  if (/miniature_golf|minigolf/.test(sport)) return 'minigolf';
  return null;
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
 * Jede Art bekommt ein eigenes Kontingent statt eines gemeinsamen Limits.
 * Grund: In dichten Innenstädten gibt es mehr Lokale als die Abfrage
 * ausliefern darf (Berlin-Mitte: rund 7900 Treffer im 4,5-km-Kasten). Mit
 * einem gemeinsamen Limit fielen ganze Arten hinten herunter – Parks und
 * Museen kamen nach hunderten Restaurants gar nicht mehr vor.
 *
 * Ebenso bewusst ohne `qt`: Diese Sortierung ordnet räumlich, das Limit
 * schneidet dann einen zusammenhängenden Streifen der Stadt ab – im
 * schlimmsten Fall genau die Umgebung des Nutzers. Ohne `qt` liefert
 * Overpass nach Objekt-Nummer; wird gekürzt, fehlen verstreute Einzelorte
 * statt eines ganzen Viertels.
 *
 * `nwr` deckt Nodes, Ways und Relations ab; `out center` liefert für Flächen
 * einen Mittelpunkt, damit wir überall mit Koordinaten rechnen können.
 */
export function buildOverpassQuery(lat: number, lon: number, radiusMeters: number): string {
  const dLat = radiusMeters / 111_320;
  const dLon = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);

  const bbox = [
    (lat - dLat).toFixed(5),
    (lon - dLon).toFixed(5),
    (lat + dLat).toFixed(5),
    (lon + dLon).toFixed(5),
  ].join(',');

  // Kontingente: genug Auswahl je Art, zusammen klein genug für eine schnelle
  // Antwort. Mehr als ein paar hundert Lokale in Laufweite braucht kein Plan.
  const bloecke: Array<[string, number]> = [
    [
      'nwr["amenity"~"^(restaurant|cafe|fast_food|ice_cream|bar|pub|biergarten|nightclub|cinema|theatre|arts_centre|casino|marketplace|public_bath)$"]["name"]',
      300,
    ],
    [
      'nwr["leisure"~"^(park|garden|nature_reserve|bowling_alley|bowling_centre|escape_game|miniature_golf|amusement_arcade|adult_gaming_centre|trampoline_park|water_park|swimming_pool|ice_rink|dance|beach_resort|sports_centre)$"]["name"]',
      150,
    ],
    ['nwr["tourism"~"^(museum|gallery|viewpoint|zoo|aquarium|theme_park|attraction)$"]["name"]', 150],
    ['nwr["shop"~"^(mall|department_store)$"]["name"]', 30],
    // Erlebnisorte hängen in OSM oft nur am `sport`-Tag – eigener Block,
    // damit Kartbahn und Lasertag nicht hinter 300 Restaurants verschwinden.
    [
      'nwr["sport"~"^(climbing|bouldering|karting|motorsport|laser_tag|lasergame|paintball|airsoft|trampoline|axe_throwing|billiards|snooker|darts|swimming|ice_skating|bowling|10pin|miniature_golf)$"]["name"]',
      60,
    ],
  ];

  const teile = bloecke.map(([filter, limit]) => `${filter};
out center ${limit};`).join('\n');
  return `[out:json][timeout:25][bbox:${bbox}];\n${teile}`;
}
