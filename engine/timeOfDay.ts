import { localHour } from '@/lib/time';
import type { Category, Place } from '@/types/domain';

/**
 * Wann ist ein Ort als Vorschlag *sinnvoll* – unabhängig davon, ob er offen hat.
 *
 * Öffnungszeiten allein reichen nicht: Eine Kneipe mit „24/7" ist um 6:40 Uhr
 * formal offen, als Morgenprogramm aber Unsinn. Genau das ist passiert, als
 * früh morgens kaum etwas anderes offen hatte.
 *
 * Angaben in Stunden. Ein Ende über 24 reicht in die Nacht (27 = 3 Uhr).
 */
const SINNVOLL: Record<Category, [number, number]> = {
  // Bis 3 Uhr nachts (27). Nicht, weil jedes Restaurant so lange offen haette
  // – sondern weil die Oeffnungszeiten das entscheiden und nicht dieses
  // Fenster. Mit 23 fiel jede Gastronomie nach 23 Uhr pauschal durch, auch der
  // Imbiss, den OpenStreetMap um 02:00 ausdruecklich als geoeffnet fuehrt.
  // Wer um 2 Uhr Hunger hat, bekommt jetzt den Laden, der wirklich auf hat;
  // geschlossene Restaurants scheitern weiterhin an Schritt 1 der harten
  // Filter. Ab 3 Uhr ist Essengehen kein Plan mehr.
  food: [11, 27],
  cafe: [7.5, 20],
  bar: [16, 27],
  activity: [10, 24],
  cinema: [12, 24.5],
  culture: [9, 22],
  nature: [6, 21],
  sport: [8, 22],
  gaming: [11, 24],
  wellness: [9, 23],
  shopping: [9, 20],
  event: [0, 30],
};

/** Clubs sind die Ausnahme innerhalb der Bars – vor 22 Uhr leer. */
const CLUB: [number, number] = [22, 29];

function fensterFuer(place: Place): [number, number] {
  if (place.kind === 'Club') return CLUB;
  return SINNVOLL[place.category];
}

/** Liegt der Beginn eines Besuchs in der sinnvollen Tageszeit dieses Ortes? */
export function fitsTimeOfDay(place: Place, start: Date, offsetMin: number): boolean {
  const [von, bis] = fensterFuer(place);
  let stunde = localHour(start, offsetMin);
  // Frühe Stunden gehören zur Nacht davor, wenn das Fenster über Mitternacht reicht.
  if (bis > 24 && stunde < bis - 24) stunde += 24;
  return stunde >= von && stunde < bis;
}
