import { localHour } from '@/lib/time';
import type { Category, PlanRequest, SequenceKind } from '@/types/domain';

/**
 * Was die Leute heute gemeinsam erleben wollen – als Struktur, nicht als
 * Stichwortliste.
 *
 * Die Oberfläche liefert Stimmungen und Kacheln, der Freitext liefert Sätze.
 * Beides wird hier auf dieselben wenigen Fragen heruntergebrochen, die für
 * den Plan wirklich zählen: Wird gegessen? Soll etwas erlebt werden? Ist es
 * ein Date? Wie viele seid ihr? Danach entscheidet die Engine mit echten
 * Daten weiter – nicht mit Worten.
 */
export type PlanIntent = {
  /** Essen gehört in den Plan. */
  food: boolean;
  /**
   * Hat der Nutzer das Essen ausdrücklich gewollt? Nur dann ist es ein hartes
   * Kriterium. Ein Essen, das nur die Uhrzeit nahelegt, darf einen echten
   * Wunsch („Kino“) niemals aus dem Plan drängen.
   */
  foodExplicit: boolean;
  /** Ein echtes Erlebnis ist gewünscht – Bowling, Kart, Escape Room … */
  experience: boolean;
  /** Zu zweit und romantisch gemeint. */
  romantic: boolean;
  /** Ruhig und gemütlich. */
  calm: boolean;
  /** Raus in die Natur – ausdrücklich gewünscht, nicht als Lückenfüller. */
  outdoor: boolean;
  /** Ein Ausklang in einer Bar passt zu diesem Abend. */
  nightcap: boolean;
  /** Ausdrücklich angetippte Kategorie; überstimmt alles andere. */
  wish?: Category;
  /**
   * Essen war der Wunsch, nicht nur eine Station nebenbei.
   *
   * Wer die Kachel „Essen" antippt, will einen Abend ums Essen herum –
   * ein Restaurant und dazu vielleicht eine Bar, keine Galerie.
   */
  foodFocus: boolean;
  /**
   * Gewünschter Ablauf, falls der Nutzer einen genannt hat. Er ist eine
   * harte Anforderung – die Engine sucht die Orte, nicht die Reihenfolge.
   */
  sequence?: SequenceKind[];
  groupSize: number;
};

/**
 * Was der Nutzer sagt → welche Kategorien dafür in Frage kommen.
 *
 * „Action“ ist bewusst mehrere Kategorien: Bowling ist `activity`, die
 * Spielhalle `gaming`, die Kletterhalle `sport` – für den Nutzer ist das
 * alles dasselbe Versprechen.
 */
export const FOLGE_ROLLEN: Record<SequenceKind, Category[]> = {
  food: ['food'],
  cafe: ['cafe'],
  bar: ['bar'],
  action: ['activity', 'gaming', 'sport'],
  cinema: ['cinema'],
  culture: ['culture'],
  nature: ['nature'],
  shopping: ['shopping'],
  wellness: ['wellness'],
  gaming: ['gaming', 'activity'],
  sport: ['sport', 'activity'],
  event: ['event'],
};

/**
 * Erlebniskategorien: Orte, in die man spontan hineingeht und etwas *tut*.
 * Bewusst ohne `nature` – ein Park ist kein Erlebnis im Sinne von „Action".
 */
export const ERLEBNIS_ROLLEN: Category[] = ['activity', 'gaming', 'sport'];

/** Kategorien, bei denen ein Park/Garten sinnvoll ist. */
export const DRAUSSEN_ROLLEN: Category[] = ['nature', 'sport'];

const ERLEBNIS_STIMMUNGEN = new Set(['action', 'gaming', 'new', 'party']);

/** Zu diesen Zeiten wird üblicherweise gegessen. */
function istEssenszeit(hour: number): boolean {
  return (hour >= 11 && hour <= 14) || (hour >= 17 && hour <= 21);
}

export function deriveIntent(request: PlanRequest, tzOffsetMin: number, start: Date): PlanIntent {
  const moods = new Set(request.moods);
  // „Essen“ ist ein Wunsch nach einem Essen, keine Hauptaktivität – dafür gibt
  // es einen eigenen Slot. Ohne diese Trennung verdrängt ein „… und danach
  // etwas essen“ im Freitext genau das, worum es eigentlich ging.
  const wish = request.focusCategory === 'food' ? undefined : request.focusCategory;
  const hour = Math.floor(localHour(start, tzOffsetMin));

  // Essen: Der ausdrückliche Schalter gewinnt. Ohne Angabe entscheidet die
  // Uhrzeit – aber nur, wenn überhaupt Zeit für mehr als eine Station ist.
  const folge = request.sequence?.length ? request.sequence : undefined;
  const foodExplicit =
    request.wantsFood === true ||
    moods.has('food') ||
    request.focusCategory === 'food' ||
    (folge?.includes('food') ?? false);
  const food =
    request.wantsFood ??
    (foodExplicit ||
      (istEssenszeit(hour) && request.availableMinutes >= 120 && !request.singleActivity));

  const experience =
    request.moods.some((m) => ERLEBNIS_STIMMUNGEN.has(m)) ||
    (wish !== undefined && ERLEBNIS_ROLLEN.includes(wish)) ||
    (folge?.some((k) => k === 'action' || k === 'gaming' || k === 'sport') ?? false);


  const romantic = moods.has('date') || (request.party === 'partner' && !moods.has('party'));
  const calm = moods.has('chill');
  const outdoor = moods.has('nature') || wish === 'nature';

  // Ein Absacker passt abends, wenn niemand dabei ist, für den eine Bar
  // nichts ist – und nur, wenn der Abend überhaupt ein Abend ist.
  const erwachsen = request.party !== 'family' && (request.age === undefined || request.age >= 18);
  const nightcap = erwachsen && (hour >= 17 || hour < 3) && !calm;

  return {
    food: folge ? folge.includes('food') || food : food,
    foodExplicit: folge ? folge.includes('food') : food && foodExplicit,
    experience,
    romantic,
    calm,
    outdoor,
    nightcap,
    wish,
    foodFocus: request.focusCategory === 'food',
    sequence: folge,
    groupSize: request.groupSize,
  };
}

/**
 * Budget pro Person aus dem Gesamtbudget der Gruppe.
 *
 * „2 Personen · 100 €" heißt 100 € für den Abend, nicht 100 € je Kopf. Die
 * Engine rechnet intern pro Person weiter, weil alle Preisangaben pro Person
 * vorliegen – geteilt wird deshalb hier, an genau einer Stelle.
 */
export function capPerPerson(request: PlanRequest): number | undefined {
  if (request.budgetTotal !== undefined) {
    return request.budgetTotal / Math.max(1, request.groupSize);
  }
  return request.budgetPerPerson;
}
