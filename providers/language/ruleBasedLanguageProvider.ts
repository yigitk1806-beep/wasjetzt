import { dictionaryFor } from '@/lib/i18n';
import type { LanguageProvider, ParsedIntent, UnderstoodToken } from '@/providers/types';
import type { BudgetPreset, Category, Mobility, Mood, Party } from '@/types/domain';

type Rule = {
  test: RegExp;
  apply: (intent: Mutable, match: RegExpMatchArray) => void;
  /** "Das habe ich verstanden" – als Schlüssel, die Oberfläche übersetzt. */
  label: UnderstoodToken | ((match: RegExpMatchArray) => UnderstoodToken);
};

type Mutable = ParsedIntent & { moods: Mood[] };

const NUMBER_WORDS: Record<string, number> = {
  eine: 1, einer: 1, ein: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5,
  sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};

function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().toLowerCase();
  const direct = Number(cleaned.replace(',', '.'));
  if (Number.isFinite(direct)) return direct;
  return NUMBER_WORDS[cleaned];
}

/** "zu zweit", "zu viert" – im Deutschen die gewohnte Art, eine Gruppe zu nennen. */
const ZU_WORT: Record<string, number> = {
  zweit: 2, dritt: 3, viert: 4, fünft: 5, fuenft: 5, sechst: 6, siebt: 7, acht: 8,
};

function addMood(intent: Mutable, mood: Mood) {
  if (!intent.moods.includes(mood)) intent.moods.push(mood);
}

const RULES: Rule[] = [
  // ---- Personen -------------------------------------------------------
  {
    test: /\b(allein|alleine|solo|by myself|für mich)\b/i,
    apply: (i) => {
      i.party = 'solo';
      i.groupSize = 1;
    },
    label: { key: 'solo' },
  },
  {
    test: /\b(freundin|freund|partner|partnerin|date|zu zweit|meiner frau|meinem mann|girlfriend|boyfriend)\b/i,
    apply: (i) => {
      i.party = 'partner';
      i.groupSize ??= 2;
    },
    label: { key: 'partner' },
  },
  {
    test: /\b(familie|kinder|mit den kids|family|kids)\b/i,
    apply: (i) => {
      i.party = 'family';
      i.groupSize ??= 4;
    },
    label: { key: 'family' },
  },
  {
    test: /\b(freunde|kumpel|jungs|mädels|maedels|clique|friends)\b/i,
    apply: (i) => {
      i.party = 'friends';
      i.groupSize ??= 4;
    },
    label: { key: 'friends' },
  },
  {
    test: /\bzu\s+(zweit|dritt|viert|fünft|fuenft|sechst|siebt|acht)\b/i,
    apply: (i, m) => {
      const n = ZU_WORT[m[1].toLowerCase()];
      if (!n) return;
      i.groupSize = n;
      i.party ??= n === 2 ? 'partner' : 'friends';
    },
    label: (m) => ({ key: 'people', args: [ZU_WORT[m[1].toLowerCase()] ?? 0] }),
  },
  {
    test: /\b(?:wir sind|zu)\s+(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|two|three|four|five|six)\b/i,
    apply: (i, m) => {
      const n = toNumber(m[1]);
      if (n) {
        i.groupSize = n;
        // Eine bereits erkannte Konstellation ("mit Freunden") hat Vorrang.
        if (n === 1) i.party = 'solo';
        else i.party ??= n === 2 ? 'partner' : 'friends';
      }
    },
    label: (m) => ({ key: 'people', args: [toNumber(m[1]) ?? 0] }),
  },
  {
    test: /\b(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs)\s+(freunde|leute|personen|people|friends)\b/i,
    apply: (i, m) => {
      const n = toNumber(m[1]);
      if (n) {
        i.groupSize = n;
        if (n === 1) i.party = 'solo';
        else i.party ??= n === 2 ? 'partner' : 'friends';
      }
    },
    label: (m) => ({ key: 'people', args: [toNumber(m[1]) ?? 0] }),
  },

  // ---- Umfang ---------------------------------------------------------
  {
    test: /\b(nur eine sache|nur eine aktivität|nur eine aktivitaet|nur etwas kleines|nur kurz etwas|just one thing|only one thing)\b/i,
    apply: (i) => {
      i.singleActivity = true;
    },
    label: { key: 'single' },
  },

  // ---- Essen ----------------------------------------------------------
  {
    test: /\b(essen gehen|abendessen|mittagessen|dinner|lunch|etwas essen|was essen|essen|restaurant|dine)\b/i,
    apply: (i) => {
      i.wantsFood = true;
      addMood(i, 'food');
    },
    label: { key: 'food' },
  },
  {
    test: /\b(ohne essen|nichts essen|kein essen|nicht essen|no food|schon gegessen)\b/i,
    apply: (i) => {
      i.wantsFood = false;
      i.moods = i.moods.filter((m) => m !== 'food');
    },
    label: { key: 'noFood' },
  },

  // ---- Budget ---------------------------------------------------------
  {
    test: /\b(kostenlos|umsonst|gratis|kein geld|free|0\s*€)\b/i,
    apply: (i) => {
      i.budget = 'free';
      i.budgetPerPerson = 0;
    },
    label: { key: 'free' },
  },
  {
    // "pro Person" ist der Sonderfall – ohne diesen Zusatz meint ein Betrag
    // das Budget der ganzen Gruppe.
    test: /(\d{1,4})\s*(?:€|eur|euro)\s*(?:pro\s*(?:person|kopf|nase)|p\.?\s?p\.?|each|per person)/i,
    apply: (i, m) => {
      const amount = Number(m[1]);
      if (!Number.isFinite(amount)) return;
      i.budgetPerPerson = amount;
      i.budget = amount <= 1 ? 'free' : amount <= 25 ? 'low' : amount <= 60 ? 'medium' : 'high';
    },
    label: (m) => ({ key: 'budget', args: [Number(m[1])] }),
  },
  {
    test: /(\d{1,4})\s*(?:€|eur|euro)/i,
    apply: (i, m) => {
      const amount = Number(m[1]);
      if (!Number.isFinite(amount) || i.budgetPerPerson !== undefined) return;
      i.budgetTotal = amount;
      const proKopf = amount / Math.max(1, i.groupSize ?? 2);
      i.budget = proKopf <= 1 ? 'free' : proKopf <= 25 ? 'low' : proKopf <= 60 ? 'medium' : 'high';
    },
    label: (m) => ({ key: 'budgetTotal', args: [Number(m[1])] }),
  },
  {
    test: /\b(günstig|guenstig|billig|wenig geld|sparen|cheap|low budget)\b/i,
    apply: (i) => {
      i.budget ??= 'low';
    },
    label: { key: 'cheap' },
  },
  {
    test: /\b(egal was es kostet|geld egal|budget egal|preis egal)\b/i,
    apply: (i) => {
      i.budget = 'any';
      i.budgetPerPerson = undefined;
    },
    label: { key: 'budgetAny' },
  },

  // ---- Zeit -----------------------------------------------------------
  {
    test: /\b(\d{1,2})\s*(?:-|bis)\s*(\d{1,2})\s*(?:stunden|std|h|hours)\b/i,
    apply: (i, m) => {
      const hi = Number(m[2]);
      if (Number.isFinite(hi)) i.availableMinutes = hi * 60;
    },
    label: (m) => ({ key: 'hoursRange', args: [Number(m[1]), Number(m[2])] }),
  },
  {
    test: /\b(\d{1,2}|eine|zwei|drei|vier|fünf|fuenf|sechs)\s*(?:stunden|stunde|std|h\b|hours|hour)/i,
    apply: (i, m) => {
      const n = toNumber(m[1]);
      if (n) i.availableMinutes = Math.round(n * 60);
    },
    label: (m) => ({ key: 'hours', args: [toNumber(m[1]) ?? 0] }),
  },
  {
    test: /\b(ganzer tag|den ganzen tag|whole day|all day)\b/i,
    apply: (i) => {
      i.availableMinutes = 480;
    },
    label: { key: 'wholeDay' },
  },
  {
    test: /\b(?:bis|um)\s*(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?\s*(?:wieder\s*)?(?:zu\s*hause|zuhause|daheim|home|back)\b/i,
    apply: (i, m) => {
      const h = Number(m[1]);
      const min = Number(m[2] ?? 0);
      if (Number.isFinite(h)) i.homeByMinutes = h * 60 + (Number.isFinite(min) ? min : 0);
    },
    label: (m) => ({ key: 'homeBy', args: [`${m[1].padStart(2, '0')}:${m[2] ?? '00'}`] }),
  },
  {
    // "ab 15 Uhr", "um 14:30 los", "starten um 18 Uhr" – aber nicht "um 22 Uhr zuhause".
    test: /\b(?:ab|um|starten um|los um)\s*(\d{1,2})(?::(\d{2}))?\s*uhr\b(?!\s*(?:wieder\s*)?(?:zu\s*hause|zuhause|daheim))/i,
    apply: (i, m) => {
      const h = Number(m[1]);
      const min = Number(m[2] ?? 0);
      if (Number.isFinite(h) && h <= 23) i.startMinutes = h * 60 + (Number.isFinite(min) ? min : 0);
    },
    label: (m) => ({ key: 'startAt', args: [`${m[1].padStart(2, '0')}:${m[2] ?? '00'}`] }),
  },
  {
    test: /\b(?:nur|hab(?:e)?|haben)\s*(?:noch\s*)?(\d{1,2})\s*(?:stunden|std|h)\b/i,
    apply: (i, m) => {
      const n = toNumber(m[1]);
      if (n) i.availableMinutes = n * 60;
    },
    label: (m) => ({ key: 'hours', args: [Number(m[1])] }),
  },
  {
    test: /\b(kurz|schnell|nicht lange|quick)\b/i,
    apply: (i) => {
      i.availableMinutes ??= 120;
    },
    label: { key: 'short' },
  },

  // ---- Stimmung -------------------------------------------------------
  {
    test: /\b(romantisch|romantic|verliebt|date.?abend|zweisamkeit)\b/i,
    apply: (i) => {
      addMood(i, 'date');
      i.party ??= 'partner';
    },
    label: { key: 'romantic' },
  },
  {
    test: /\b(action|adrenalin|sportlich|aktiv|bewegen|krass|verrückt|verrueckt|crazy|wild)\b/i,
    apply: (i) => addMood(i, 'action'),
    label: { key: 'action' },
  },
  {
    test: /\b(entspann|chill|ruhig|gemütlich|gemuetlich|relax|locker)\w*/i,
    apply: (i) => addMood(i, 'chill'),
    label: { key: 'chill' },
  },
  {
    test: /\b(party|feiern|tanzen|club|drinks|cocktails)\b/i,
    apply: (i) => addMood(i, 'party'),
    label: { key: 'party' },
  },
  {
    test: /\b(essen|hunger|restaurant|dinner|lecker|food|abendessen)\b/i,
    apply: (i) => {
      addMood(i, 'food');
      i.focusCategory ??= 'food';
    },
    label: { key: 'food' },
  },
  {
    test: /\b(natur|draußen|draussen|grün|gruen|frische luft|spazier|wald|see|park)\w*/i,
    apply: (i) => addMood(i, 'nature'),
    label: { key: 'nature' },
  },
  {
    test: /\b(gaming|zocken|konsole|vr|arcade)\b/i,
    apply: (i) => {
      addMood(i, 'gaming');
      i.focusCategory ??= 'gaming';
    },
    label: { key: 'gaming' },
  },
  {
    test: /\b(neu|noch nie|was anderes|abwechslung|something new|mal was)\b/i,
    apply: (i) => {
      addMood(i, 'new');
      i.preferNovelty = true;
    },
    label: { key: 'new' },
  },
  {
    test: /\b(kino|film|movie|cinema)\b/i,
    apply: (i) => {
      i.focusCategory = 'cinema';
    },
    label: { key: 'cinema' },
  },
  {
    test: /\b(café|cafe|kaffee|coffee|kuchen)\b/i,
    apply: (i) => {
      i.focusCategory ??= 'cafe';
    },
    label: { key: 'cafe' },
  },
  {
    test: /\b(museum|ausstellung|kultur|theater)\b/i,
    apply: (i) => {
      i.focusCategory ??= 'culture';
    },
    label: { key: 'culture' },
  },

  // ---- Wetter / Ort ---------------------------------------------------
  {
    test: /\b(es regnet|regen|schlechtes wetter|raining|rainy|drinnen|indoor)\b/i,
    apply: (i) => {
      i.avoidOutdoor = true;
    },
    label: { key: 'indoor' },
  },
  {
    test: /\b(nicht weit|in der nähe|in der naehe|um die ecke|nah|close by|nearby|keine lust zu fahren)\b/i,
    apply: (i) => {
      i.maxDistanceMeters = 2500;
    },
    label: { key: 'near' },
  },

  // ---- Mobilität ------------------------------------------------------
  {
    test: /\b(zu fuß|zu fuss|laufen|walking|on foot)\b/i,
    apply: (i) => {
      i.mobility = 'walk';
    },
    label: { key: 'walk' },
  },
  {
    test: /\b(fahrrad|rad|bike|velo)\b/i,
    apply: (i) => {
      i.mobility = 'bike';
    },
    label: { key: 'bike' },
  },
  {
    test: /\b(auto|wagen|car|fahren wir)\b/i,
    apply: (i) => {
      i.mobility = 'car';
    },
    label: { key: 'car' },
  },
  {
    test: /\b(bahn|öpnv|oepnv|bus|u-?bahn|s-?bahn|transit|public transport)\b/i,
    apply: (i) => {
      i.mobility = 'transit';
    },
    label: { key: 'transit' },
  },
];

/**
 * Regelbasierter Parser – schnell, offline, ohne API-Kosten.
 * Er versteht bewusst nur das, was er sicher erkennt; alles andere
 * bleibt leer und wird von der Engine mit sinnvollen Annahmen gefüllt.
 * Ein LLM-Provider kann dieses Interface später ersetzen oder ergänzen.
 */
export class RuleBasedLanguageProvider implements LanguageProvider {
  readonly id = 'rules';

  async parse(text: string, locale = 'de'): Promise<ParsedIntent> {
    const intent: Mutable = { moods: [], understood: [], understoodTokens: [], confidence: 0 };
    if (!text.trim()) return intent;

    for (const rule of RULES) {
      const match = text.match(rule.test);
      if (!match) continue;
      rule.apply(intent, match);
      const token = typeof rule.label === 'function' ? rule.label(match) : rule.label;
      const verstanden = understoodText(locale, token);
      if (!intent.understood.includes(verstanden)) {
        intent.understood.push(verstanden);
        intent.understoodTokens!.push(token);
      }
    }

    intent.confidence = Math.min(1, intent.understood.length / 4);
    return intent;
  }
}

/** Ein verstandener Punkt als Text – in der gewünschten Sprache. */
export function understoodText(locale: string, token: UnderstoodToken): string {
  const eintrag = dictionaryFor(locale).understood[token.key] as
    | string
    | ((...args: Array<string | number>) => string);
  return typeof eintrag === 'function' ? eintrag(...(token.args ?? [])) : eintrag;
}

export type { Party, Mood, Mobility, BudgetPreset, Category };
