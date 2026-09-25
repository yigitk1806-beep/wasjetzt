import type { Category, SequenceKind } from '@/types/domain';
import type { DayPart } from '@/lib/time';
import { DRAUSSEN_ROLLEN, ERLEBNIS_ROLLEN, FOLGE_ROLLEN } from './intent';
import type { PlanContext, Slot } from './types';

/**
 * Erlebnisorte in absteigender Eignung für „Action". Bewusst konkret: Wer
 * Action will, meint Bowling, Kart oder Escape Room – nicht einen Park, der
 * zufällig kostenlos und offen ist.
 */
const ERLEBNIS: Category[] = ['activity', 'gaming', 'sport'];

/** Ruhiges Programm: etwas ansehen, etwas trinken, spazieren. */
const RUHIG: Category[] = ['culture', 'cafe', 'nature', 'wellness'];

/**
 * Alleine unterwegs. Was zu zweit oder in der Gruppe trägt, trägt allein
 * nicht unbedingt – und umgekehrt: Ein Museum, ein Kino oder eine Stunde im
 * Arcade funktionieren allein hervorragend.
 */
const ALLEIN: Category[] = ['culture', 'cinema', 'gaming', 'cafe', 'sport', 'wellness', 'shopping'];

/** Romantisch, ohne Action-Wunsch. */
const ROMANTISCH: Category[] = ['culture', 'cinema', 'wellness', 'activity', 'nature'];

/** Rückfall nach Tageszeit, wenn der Nutzer nichts Näheres gesagt hat. */
const TAGESZEIT: Record<DayPart, Category[]> = {
  morning: ['cafe', 'culture', 'nature', 'activity'],
  midday: ['food', 'culture', 'activity', 'nature'],
  afternoon: ['activity', 'culture', 'nature', 'gaming'],
  evening: ['activity', 'cinema', 'gaming', 'culture'],
  night: ['bar', 'gaming', 'activity'],
};

const AUSKLANG: Record<DayPart, Category[]> = {
  morning: ['cafe'],
  midday: ['cafe'],
  afternoon: ['cafe', 'bar'],
  evening: ['bar', 'cafe'],
  night: ['bar'],
};

function dedupe<T>(list: T[]): T[] {
  return Array.from(new Set(list));
}

/**
 * Die Hauptaktivität – geordnet nach dem, was der Nutzer tatsächlich gesagt
 * hat. Reihenfolge ist Bedeutung: Der erste Eintrag gewinnt im Ranking.
 */
function hauptRollen(ctx: PlanContext): Category[] {
  const { intent } = ctx;
  if (intent.wish) return dedupe([intent.wish, ...verwandte(intent.wish)]);
  if (intent.experience) return dedupe([...ERLEBNIS, ...(intent.outdoor ? DRAUSSEN_ROLLEN : [])]);
  // Wer „Essen" gewählt hat, bekommt einen Abend ums Essen herum: das
  // Lokal hat einen eigenen Slot, hier kommt dazu, was dazu passt.
  //
  // Steht bewusst hinter dem Erlebnis: Das Wort „essen" in einem Satz wie
  // „etwas Action und danach essen" setzt ebenfalls diese Kachel – stünde
  // die Regel vorn, würde aus der Action eine Bar.
  if (intent.foodFocus) return dedupe(['cafe', 'bar', 'culture', 'cinema']);
  if (intent.outdoor) return dedupe([...DRAUSSEN_ROLLEN, 'culture']);
  if (intent.romantic) return dedupe([...ROMANTISCH, ...TAGESZEIT[ctx.dayPart]]);
  if (intent.calm) return dedupe([...RUHIG, ...TAGESZEIT[ctx.dayPart]]);
  if (ctx.request.party === 'solo') return dedupe([...ALLEIN, ...TAGESZEIT[ctx.dayPart]]);
  return TAGESZEIT[ctx.dayPart];
}

/**
 * Wenn eine Kategorie ausdrücklich gewünscht ist und es sie hier nicht gibt,
 * sind das die nächstbesten Verwandten – nicht „irgendetwas".
 */
function verwandte(wish: Category): Category[] {
  switch (wish) {
    case 'gaming':
      return ['activity'];
    case 'activity':
      return ['gaming', 'sport'];
    case 'sport':
      return ['activity'];
    case 'cafe':
      return ['bar'];
    case 'bar':
      return ['cafe'];
    case 'culture':
      return ['cinema'];
    case 'cinema':
      return ['culture'];
    case 'nature':
      return ['sport'];
    default:
      return [];
  }
}

/**
 * Hat der Nutzer überhaupt etwas Bestimmtes gesagt?
 *
 * Wer auf „Jetzt los“ tippt, sagt nichts – dann soll der Nachmittag trotzdem
 * gefüllt werden. Die Regel „nicht auffüllen“ richtet sich gegen Stationen,
 * die einem geäußerten Wunsch widersprechen, nicht gegen einen Plan überhaupt.
 */
function unspezifisch(ctx: PlanContext): boolean {
  const { intent } = ctx;
  return (
    intent.wish === undefined &&
    !intent.experience &&
    !intent.romantic &&
    !intent.calm &&
    !intent.outdoor &&
    !intent.foodExplicit
  );
}

/** Zweite Station neben der Hauptaktivität – nur, wenn sie etwas beiträgt. */
function zweiteRollen(ctx: PlanContext, haupt: Category[]): Category[] {
  const { intent } = ctx;
  const offen: Category[] = [];
  // Mehrere Wünsche gleichzeitig: Was der Hauptslot nicht abdeckt, kommt hier.
  if (intent.experience && intent.romantic) offen.push('culture', 'cinema');
  if (intent.outdoor) offen.push(...DRAUSSEN_ROLLEN);
  if (intent.calm) offen.push('cafe', 'culture');
  if (intent.experience) offen.push(...ERLEBNIS);
  // Ohne bestimmten Wunsch: das, was zu dieser Tageszeit naheliegt.
  if (unspezifisch(ctx)) offen.push(...TAGESZEIT[ctx.dayPart]);
  if (intent.foodFocus) offen.push('cafe', 'bar');
  const rest = dedupe(offen.filter((c) => c !== haupt[0]));
  return rest.length > 0 ? rest : [];
}

function ausklangRollen(ctx: PlanContext): Category[] {
  const base = AUSKLANG[ctx.dayPart];
  if (ctx.request.party === 'family') return dedupe(['cafe', ...base.filter((c) => c !== 'bar')]);
  if (ctx.request.age !== undefined && ctx.request.age < 18) {
    return dedupe(['cafe', ...base.filter((c) => c !== 'bar')]);
  }
  return base;
}

/**
 * Worauf der Hauptslot ausweichen darf, wenn sich seine erste Wahl nicht
 * erfüllen lässt.
 *
 * Wer „Café“ antippt, bekommt notfalls eine Bar – aber niemals einen Park,
 * nur weil der offen ist. Ein ausdrücklicher Wunsch wird lieber ehrlich nicht
 * erfüllt als still durch etwas anderes ersetzt. Ohne Wunsch darf der Plan
 * das nehmen, was zur Tageszeit passt.
 */
function ersatzRollen(ctx: PlanContext, haupt: Category[]): Category[] | undefined {
  const { intent } = ctx;
  if (intent.wish) return haupt;
  // Kein „culture“: Eine Galerie ist keine Action. Lässt sich der Wunsch
  // nicht erfüllen, sagt der Plan das lieber, als ihn still umzudeuten.
  // Kino bleibt drin – es ist ein Programmpunkt, kein Ausstellungsbesuch.
  if (intent.experience) return dedupe([...ERLEBNIS, 'cinema']);
  return dedupe([...haupt, ...TAGESZEIT[ctx.dayPart]]);
}

/**
 * Der gewünschte Ablauf als Slot-Kette.
 *
 * Jede Position ist Pflicht und weicht nicht auf andere Kategorien aus: Wer
 * „erst essen, dann Action“ sagt, bekommt kein Museum an Position zwei, nur
 * weil das näher läge. Lässt sich eine Position nicht füllen, sagt der Plan
 * das – er ordnet nicht heimlich um.
 */
function ausFolge(ctx: PlanContext, folge: SequenceKind[], minutes: number): Slot[] {
  const proSlot = Math.max(30, Math.floor((minutes - folge.length * 15) / folge.length));
  return folge.map((kind, i) => folgeSlot(kind, proSlot, i, folge.length));
}

/** Kurze Stationen bleiben kurz: Ein Café braucht keine zwei Stunden. */
const FOLGE_MAX_MIN: Partial<Record<SequenceKind, number>> = {
  cafe: 60,
  bar: 75,
  food: 90,
  shopping: 75,
};

function folgeSlot(kind: SequenceKind, proSlot: number, index: number, anzahl: number): Slot {
  const grenze = FOLGE_MAX_MIN[kind];
  return {
    roles: FOLGE_ROLLEN[kind],
    // Kein Ausweichen: Die Reihenfolge ist eine Zusage, keine Anregung.
    fallbackRoles: undefined,
    targetMinutes: grenze ? Math.min(proSlot, grenze) : proSlot,
    optional: false,
    label:
      kind === 'food'
        ? 'food'
        : index === anzahl - 1 && (kind === 'cafe' || kind === 'bar')
          ? 'winddown'
          : index === 0
            ? 'main'
            : 'secondary',
    need: 'sequence',
    sequenceKind: kind,
  };
}

/**
 * Baut die Slot-Struktur des Plans.
 *
 * Grundsatz: Jeder Slot erfüllt einen Wunsch, den der Nutzer geäußert hat.
 * Es gibt keinen Slot „noch irgendwas" – lieber zwei sehr passende Stationen
 * als vier mittelmäßige. Pflicht-Slots (Essen, Hauptaktivität) müssen gefüllt
 * werden; alles andere darf entfallen, wenn nichts wirklich Passendes da ist.
 */
export function buildSlots(ctx: PlanContext): Slot[] {
  const minutes = ctx.request.availableMinutes;
  const { intent } = ctx;
  const haupt = hauptRollen(ctx);

  // Eine einzelne Aktivität: nur der Hauptwunsch, nichts drumherum.
  if (ctx.request.singleActivity || minutes <= 100) {
    return [
      {
        roles: intent.food && !intent.experience && !intent.wish ? ['food', 'cafe'] : haupt,
        fallbackRoles: ersatzRollen(ctx, haupt),
        targetMinutes: Math.min(minutes - 15, 90),
        optional: false,
        label: 'main',
        need: intent.food && !intent.experience ? 'food' : 'main',
      },
    ];
  }

  // Hat der Nutzer einen Ablauf genannt, ist der die Struktur des Plans.
  // Optimiert wird dann nur noch, WELCHE Orte an die Positionen kommen.
  if (intent.sequence && intent.sequence.length >= 2) {
    return ausFolge(ctx, intent.sequence, minutes);
  }

  const maxSlots = minutes <= 170 ? 2 : minutes <= 330 ? 3 : 4;
  const budgetPerSlot = Math.floor((minutes - maxSlots * 15) / maxSlots);

  const essen: Slot = {
    roles: ['food'],
    fallbackRoles: intent.foodExplicit ? ['food', 'cafe'] : undefined,
    targetMinutes: Math.min(budgetPerSlot, 90),
    // Ein Essen, das nur die Uhrzeit nahelegt, darf entfallen. Ein gewolltes
    // Essen nicht – sonst wäre der Plan nicht der, nach dem gefragt wurde.
    optional: !intent.foodExplicit,
    label: 'food',
    need: 'food',
  };
  const hauptSlot: Slot = {
    roles: haupt,
    fallbackRoles: ersatzRollen(ctx, haupt),
    targetMinutes: budgetPerSlot,
    optional: false,
    label: 'main',
    need: intent.experience ? 'experience' : 'main',
  };
  const zweite = zweiteRollen(ctx, haupt);
  const zweiterSlot: Slot | null =
    zweite.length > 0
      ? {
          roles: zweite,
          targetMinutes: budgetPerSlot,
          optional: true,
          label: 'secondary',
          need: 'extra',
        }
      : null;
  const ausklang: Slot = {
    roles: ausklangRollen(ctx),
    targetMinutes: Math.min(budgetPerSlot, 60),
    optional: true,
    label: 'winddown',
    need: 'winddown',
  };

  const slots: Slot[] = [];

  // Eine einzelne genannte Position heißt „das zuerst“ – danach ergänzt die
  // Engine wie gewohnt.
  const zuerst = intent.sequence?.length === 1 ? intent.sequence[0] : null;
  if (zuerst) {
    slots.push(folgeSlot(zuerst, budgetPerSlot, 0, 1));
    // Danach das Übliche – aber nichts, was der Nutzer nicht wollte. Wer
    // „erst Café" sagt, bekommt nicht automatisch ein Abendessen dazu.
    if (zuerst !== 'food' && intent.food) slots.push(essen);
    else if (zuerst === 'food') slots.push(hauptSlot);
    // Ein Absacker nur, wenn die genannte Position nicht selbst einer ist.
    const istAusklang = zuerst === 'cafe' || zuerst === 'bar';
    if (slots.length < maxSlots && intent.nightcap && !istAusklang) slots.push(ausklang);
    return slots.slice(0, maxSlots);
  }

  // Reihenfolge: erst die Unternehmung, dann das Essen, dann der Ausklang.
  //
  // Wer Action und Essen will, geht erst bowlen und danach essen – nicht
  // umgekehrt. Das gilt auch für einen ausdrücklich angetippten Wunsch:
  // Ein Essen, das nur die Uhrzeit nahelegt, darf ihm nicht die Zeit wegnehmen.
  // Reines Essen ohne Unternehmung bleibt vorn, und morgens beginnt niemand
  // mit dem Abendessen.
  const wunschZuerst = intent.experience || intent.wish !== undefined;

  if (ctx.dayPart === 'morning' || wunschZuerst) {
    slots.push(hauptSlot);
    if (intent.food) slots.push(essen);
  } else {
    if (intent.food) slots.push(essen);
    slots.push(hauptSlot);
  }

  if (slots.length < maxSlots && zweiterSlot) slots.push(zweiterSlot);
  // Der Ausklang kommt, wenn der Abend danach ist – oder wenn niemand etwas
  // Bestimmtes wollte und noch Zeit übrig ist. Er bleibt optional: Findet
  // sich nichts Passendes, endet der Plan eben früher.
  if (slots.length < maxSlots && (intent.nightcap || unspezifisch(ctx) || intent.calm)) {
    slots.push(ausklang);
  }

  return slots.slice(0, maxSlots);
}
