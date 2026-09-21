import { formatDuration } from '@/lib/time';
import type { DayPart } from '@/lib/time';
import type { Party, Place, PlanStep, WeatherSlice } from '@/types/domain';
import type { PlanContext } from './types';
import { weatherModeOf } from './weatherRules';

const DAYPART_NOUN: Record<DayPart, string> = {
  morning: 'Vormittag',
  midday: 'Mittag',
  afternoon: 'Nachmittag',
  evening: 'Abend',
  night: 'Nacht',
};

export function planTitle(ctx: PlanContext): string {
  const noun = DAYPART_NOUN[ctx.dayPart];
  const possessive: Record<Party, string> = {
    solo: 'Dein',
    partner: 'Euer',
    friends: 'Euer',
    family: 'Euer',
  };
  return `${possessive[ctx.request.party]} ${noun}`;
}

export function planSummary(steps: PlanStep[], ctx: PlanContext): string {
  if (steps.length === 0) return 'Gerade finde ich hier nichts Passendes.';
  const kinds = steps.map((s) => s.place.kind);
  const list =
    kinds.length === 1
      ? kinds[0]
      : `${kinds.slice(0, -1).join(', ')} und ${kinds[kinds.length - 1]}`;
  const minutes =
    (new Date(steps[steps.length - 1].endISO).getTime() -
      new Date(steps[0].startISO).getTime()) /
    60000;
  return `${list} – ${formatDuration(Math.round(minutes), ctx.request.language)}`;
}

/**
 * Ein kurzer, ehrlicher Satz, warum dieser Ort gewählt wurde.
 * `avoid` verhindert, dass in einem Plan dreimal derselbe Satz steht.
 * Angebote stehen bewusst nicht hier – die zeigt die UI als eigenes Label.
 */
export function stepReason(
  place: Place,
  ctx: PlanContext,
  weatherAtStart: WeatherSlice | null,
  distanceMeters: number,
  avoid: string[] = [],
): string {
  const mode = weatherModeOf(weatherAtStart);
  const candidates: string[] = [];

  if (mode === 'wet' && place.indoorOutdoor === 'indoor') {
    candidates.push('Drinnen – passt zum Regen.');
  }
  if (mode === 'pleasant' && place.indoorOutdoor === 'outdoor') {
    candidates.push('Draußen – das Wetter spielt mit.');
  }
  if (mode === 'hot' && place.heatSuitability >= 0.95) {
    candidates.push('Angenehm bei der Wärme.');
  }
  if (mode === 'cold' && place.coldSuitability >= 0.9) {
    candidates.push('Warm und trocken.');
  }
  if (ctx.request.moods.includes('date') && place.scores.romantic >= 0.8) {
    candidates.push('Ruhig genug für zu zweit.');
  }
  if (ctx.request.moods.includes('action') && place.scores.action >= 0.75) {
    candidates.push('Da ist was los.');
  }
  if (ctx.request.party === 'family' && place.scores.family >= 0.85) {
    candidates.push('Funktioniert mit Kindern gut.');
  }
  if (
    (ctx.request.budget === 'free' || ctx.request.budget === 'low') &&
    place.price.level <= 1
  ) {
    candidates.push(place.price.level === 0 ? 'Kostet nichts.' : 'Günstig und nah.');
  }
  if (ctx.request.preferNovelty && place.scores.novelty >= 0.7) {
    candidates.push('Mal etwas anderes.');
  }
  if (distanceMeters < 900) {
    candidates.push('Gleich um die Ecke.');
  }
  candidates.push(CATEGORY_REASON[place.category]);
  candidates.push('Passt zur Uhrzeit und ist offen.');

  return candidates.find((reason) => !avoid.includes(reason)) ?? candidates[0];
}

/** Letzter Rückfall: ein Satz, der zur Art des Ortes passt. */
const CATEGORY_REASON: Record<Place['category'], string> = {
  food: 'Gute Zeit für etwas zu essen.',
  cafe: 'Gute Stelle für eine Pause.',
  bar: 'Guter Ausklang.',
  activity: 'Da kommt keine Langeweile auf.',
  cinema: 'Ihr müsst euch um nichts kümmern.',
  culture: 'Etwas fürs Auge.',
  nature: 'Einmal raus und durchatmen.',
  sport: 'Bringt euch in Bewegung.',
  gaming: 'Da kommt keine Langeweile auf.',
  wellness: 'Zum Runterkommen.',
  shopping: 'Zum Stöbern und Treibenlassen.',
  event: 'Gibt es nur heute.',
};

/**
 * Tourtitel aus dem Ort, den der Nutzer gewählt hat – ohne ausgedachten
 * Stadtnamen, wenn nur ein GPS-Standort vorliegt.
 */
export function tourTitle(ctx: PlanContext): string {
  const label = ctx.request.originLabel?.trim();
  const ort = !label || label === 'Dein Standort' ? 'Deine Umgebung' : label;
  return `${ort} entdecken`;
}

/**
 * „6 Stationen · 5,2 km". Pausen zählen nicht als Station. Das „ca." steht
 * nur, solange mindestens ein Weg geschätzt statt echt geroutet ist.
 */
export function tourSummary(steps: PlanStep[]): string {
  const stationen = steps.filter((s) => s.place.themes?.length).length;
  const meter = steps.reduce((sum, s) => sum + s.travelFromPrevious.distanceMeters, 0);
  const km = (meter / 1000).toLocaleString('de', { maximumFractionDigits: 1 });
  const geschaetzt = steps.some((s) => s.travelFromPrevious.estimated);
  const wort = stationen === 1 ? 'Station' : 'Stationen';
  const unterwegs = UNTERWEGS[steps[0]?.travelFromPrevious.mode ?? 'walk'];
  return `${stationen} ${wort} · ${geschaetzt ? 'ca. ' : ''}${km} km ${unterwegs}`;
}

const UNTERWEGS: Record<PlanStep['travelFromPrevious']['mode'], string> = {
  walk: 'zu Fuß',
  bike: 'mit dem Rad',
  transit: 'mit Bus & Bahn',
  car: 'mit dem Auto',
};
