import type { OpeningHours, Weekday } from '@/types/domain';
import type { ProfileKey } from '@/providers/activityProfiles';

type HourSpec = {
  /** "09:30" */
  open: string;
  /** "23:00" – "26:00" bedeutet 02:00 in der Nacht. */
  close: string;
  /** Wochentage; Standard: alle. */
  days?: Weekday[];
};

const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4];
const WEEKEND: Weekday[] = [5, 6];

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function buildHours(specs: HourSpec[]): OpeningHours {
  const hours: OpeningHours = {};
  for (const spec of specs) {
    for (const day of spec.days ?? ALL_DAYS) {
      const list = hours[day] ?? [];
      list.push({ openMin: toMinutes(spec.open), closeMin: toMinutes(spec.close) });
      hours[day] = list;
    }
  }
  return hours;
}

const HOURS = {
  food: buildHours([{ open: '11:30', close: '23:00' }]),
  fastfood: buildHours([{ open: '11:00', close: '23:00' }]),
  fine: buildHours([{ open: '18:00', close: '23:00', days: [2, 3, 4, 5, 6] }]),
  cafe: buildHours([
    { open: '08:00', close: '19:00', days: WEEKDAYS },
    { open: '09:00', close: '20:00', days: WEEKEND },
  ]),
  icecream: buildHours([{ open: '11:00', close: '21:00' }]),
  bar: buildHours([
    { open: '17:00', close: '25:00', days: WEEKDAYS },
    { open: '17:00', close: '27:00', days: WEEKEND },
  ]),
  biergarten: buildHours([{ open: '15:00', close: '23:00' }]),
  bowling: buildHours([
    { open: '14:00', close: '24:00', days: WEEKDAYS },
    { open: '12:00', close: '25:00', days: WEEKEND },
  ]),
  daytime: buildHours([{ open: '10:00', close: '20:00' }]),
  evening: buildHours([{ open: '12:00', close: '23:00' }]),
  arcade: buildHours([{ open: '13:00', close: '24:00' }]),
  cinema: buildHours([{ open: '13:00', close: '23:30' }]),
  museum: buildHours([{ open: '10:00', close: '18:00', days: [0, 2, 3, 4, 5, 6] }]),
  theatre: buildHours([{ open: '19:00', close: '23:00', days: [3, 4, 5, 6] }]),
  outdoor: buildHours([{ open: '06:00', close: '23:00' }]),
  lake: buildHours([{ open: '07:00', close: '21:00' }]),
  pool: buildHours([{ open: '07:00', close: '22:00' }]),
  spa: buildHours([{ open: '09:00', close: '23:00' }]),
  climbing: buildHours([{ open: '09:00', close: '23:00' }]),
  market: buildHours([{ open: '09:00', close: '16:00', days: [4, 5, 6] }]),
  karaoke: buildHours([{ open: '18:00', close: '27:00', days: [4, 5, 6] }]),
  streetfood: buildHours([{ open: '12:00', close: '22:00', days: [3, 4, 5, 6] }]),
} satisfies Record<string, OpeningHours>;

/**
 * Bauplan für Demo-Orte. Alle Namen sind frei erfunden und dienen nur dazu,
 * die App auch ohne erreichbare Datenquelle vorführen zu können.
 * Die fachlichen Eigenschaften kommen aus den gemeinsamen Aktivitätsprofilen.
 */
export type MockTemplate = {
  profile: ProfileKey;
  names: string[];
  openingHours: OpeningHours;
  /** Wie viele Instanzen pro Zelle erzeugt werden. */
  density: number;
  /** Große Werte = Ort liegt eher am Rand der Zelle (See, Therme …). */
  spreadMeters: number;
};

export const MOCK_TEMPLATES: MockTemplate[] = [
  { profile: 'italian', names: ['Trattoria Vento', 'Osteria Fiora', 'Casa Lumo', 'Pasta Nova'], openingHours: HOURS.food, density: 4, spreadMeters: 1200 },
  { profile: 'asian', names: ['Ramen Kojo', 'Bao & Bowl', 'Sakura Tisch', 'Wok Nummer 9'], openingHours: HOURS.food, density: 4, spreadMeters: 1000 },
  { profile: 'burger', names: ['Patty Riot', 'Grill & Grün', 'Bun Society'], openingHours: HOURS.food, density: 3, spreadMeters: 1100 },
  { profile: 'pizza', names: ['Forno Rosso', 'Teigwerk', 'Napoli Ecke'], openingHours: HOURS.food, density: 3, spreadMeters: 900 },
  { profile: 'fastfood', names: ['Kiosk Sieben', 'Schnelle Ecke'], openingHours: HOURS.fastfood, density: 2, spreadMeters: 900 },
  { profile: 'fine_dining', names: ['Restaurant Nordlicht', 'Tisch Elf', 'Salz & Seide'], openingHours: HOURS.fine, density: 2, spreadMeters: 1600 },
  { profile: 'streetfood', names: ['Streetfood Hof', 'Kantine Draußen'], openingHours: HOURS.streetfood, density: 2, spreadMeters: 1500 },
  { profile: 'cafe', names: ['Café Kolibri', 'Röstwerk', 'Milch & Mohn', 'Kaffeezimmer', 'Bohne & Buch'], openingHours: HOURS.cafe, density: 5, spreadMeters: 900 },
  { profile: 'icecream', names: ['Eissalon Sole', 'Gelato Piccolo', 'Kalte Ecke'], openingHours: HOURS.icecream, density: 3, spreadMeters: 1000 },
  { profile: 'bar', names: ['Bar Halbmond', 'Zimmer 12', 'Sonar Bar', 'Die Kleine Theke'], openingHours: HOURS.bar, density: 3, spreadMeters: 1300 },
  { profile: 'pub', names: ['Zum Anker', 'Eckkneipe Nord'], openingHours: HOURS.bar, density: 2, spreadMeters: 1200 },
  { profile: 'biergarten', names: ['Garten am Wasser', 'Linden Ausschank'], openingHours: HOURS.biergarten, density: 2, spreadMeters: 2000 },
  { profile: 'bowling', names: ['Strike Halle', 'Pin Palast', 'Bowling Nordstern'], openingHours: HOURS.bowling, density: 2, spreadMeters: 3000 },
  { profile: 'escape', names: ['Raum 13', 'Schlüsselwerk', 'Exit Labor'], openingHours: HOURS.evening, density: 2, spreadMeters: 2600 },
  { profile: 'vr', names: ['VR Deck', 'Holo Halle', 'Nullraum'], openingHours: HOURS.evening, density: 1, spreadMeters: 3200 },
  { profile: 'arcade', names: ['Pixelhalle', 'Joystick Klub', 'Arcade Ost'], openingHours: HOURS.arcade, density: 2, spreadMeters: 2400 },
  { profile: 'cinema', names: ['Lichtspiele Central', 'Kino Astra', 'Filmhaus Süd'], openingHours: HOURS.cinema, density: 2, spreadMeters: 2800 },
  { profile: 'museum', names: ['Museum am Hafen', 'Sammlung Weiß', 'Haus der Dinge'], openingHours: HOURS.museum, density: 2, spreadMeters: 3000 },
  { profile: 'theatre', names: ['Kleine Bühne', 'Theater Kanal', 'Kulturwerk'], openingHours: HOURS.theatre, density: 1, spreadMeters: 3200 },
  { profile: 'park', names: ['Stadtpark Nord', 'Grüner Ring', 'Wiesenaue'], openingHours: HOURS.outdoor, density: 3, spreadMeters: 1400 },
  { profile: 'beach', names: ['Badesee Ost', 'Stiller Weiher', 'Seeufer Klein'], openingHours: HOURS.lake, density: 1, spreadMeters: 6000 },
  { profile: 'viewpoint', names: ['Panoramahügel', 'Hoher Blick', 'Terrasse Oben'], openingHours: HOURS.outdoor, density: 2, spreadMeters: 3500 },
  { profile: 'climbing', names: ['Boulderwerk', 'Griffpunkt', 'Vertikal Halle'], openingHours: HOURS.climbing, density: 1, spreadMeters: 3000 },
  { profile: 'pool', names: ['Wellenbad', 'Schwimmhalle Mitte', 'Freibad Aue'], openingHours: HOURS.pool, density: 1, spreadMeters: 2800 },
  { profile: 'minigolf', names: ['Minigolf Wiesengrund', 'Bahn 18', 'Golfgarten'], openingHours: HOURS.daytime, density: 1, spreadMeters: 2600 },
  { profile: 'bike', names: ['Radweg am Kanal', 'Tour Grüne Route', 'Uferrunde'], openingHours: HOURS.outdoor, density: 1, spreadMeters: 1500 },
  { profile: 'spa', names: ['Thermenhaus', 'Sauna Ruheort', 'Dampf & Stille'], openingHours: HOURS.spa, density: 1, spreadMeters: 5000 },
  { profile: 'icerink', names: ['Eisfläche Nord', 'Schlittschuhhalle', 'Winterbahn'], openingHours: HOURS.daytime, density: 1, spreadMeters: 3400 },
  { profile: 'market', names: ['Wochenmarkt Platz', 'Hallenmarkt', 'Trödel am Ufer'], openingHours: HOURS.market, density: 1, spreadMeters: 2000 },
  { profile: 'karaoke', names: ['Singraum', 'Karaoke Box 7', 'Mikro Klub'], openingHours: HOURS.karaoke, density: 1, spreadMeters: 2800 },
];
