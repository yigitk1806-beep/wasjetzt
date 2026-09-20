import type { LanguageProvider, ParsedIntent } from '@/providers/types';
import type { BudgetPreset, Category, Mobility, Mood, Party } from '@/types/domain';

type Rule = {
  test: RegExp;
  apply: (intent: Mutable, match: RegExpMatchArray) => void;
  /** Kurzer Text für "Das habe ich verstanden". */
  label: string | ((match: RegExpMatchArray) => string);
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
    label: 'alleine unterwegs',
  },
  {
    test: /\b(freundin|freund|partner|partnerin|date|zu zweit|meiner frau|meinem mann|girlfriend|boyfriend)\b/i,
    apply: (i) => {
      i.party = 'partner';
      i.groupSize ??= 2;
    },
    label: 'zu zweit',
  },
  {
    test: /\b(familie|kinder|mit den kids|family|kids)\b/i,
    apply: (i) => {
      i.party = 'family';
      i.groupSize ??= 4;
    },
    label: 'mit Familie',
  },
  {
    test: /\b(freunde|kumpel|jungs|mädels|maedels|clique|friends)\b/i,
    apply: (i) => {
      i.party = 'friends';
      i.groupSize ??= 4;
    },
    label: 'mit Freunden',
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
    label: (m) => `${toNumber(m[1]) ?? '?'} Personen`,
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
    label: (m) => `${toNumber(m[1]) ?? '?'} Personen`,
  },

  // ---- Budget ---------------------------------------------------------
  {
    test: /\b(kostenlos|umsonst|gratis|kein geld|free|0\s*€)\b/i,
    apply: (i) => {
      i.budget = 'free';
      i.budgetPerPerson = 0;
    },
    label: 'kostenlos',
  },
  {
    test: /(\d{1,4})\s*(?:€|eur|euro)/i,
    apply: (i, m) => {
      const amount = Number(m[1]);
      if (!Number.isFinite(amount)) return;
      i.budgetPerPerson = amount;
      i.budget = amount <= 1 ? 'free' : amount <= 25 ? 'low' : amount <= 60 ? 'medium' : 'high';
    },
    label: (m) => `Budget ${m[1]} €`,
  },
  {
    test: /\b(günstig|guenstig|billig|wenig geld|sparen|cheap|low budget)\b/i,
    apply: (i) => {
      i.budget ??= 'low';
    },
    label: 'günstig',
  },
  {
    test: /\b(egal was es kostet|geld egal|budget egal|preis egal)\b/i,
    apply: (i) => {
      i.budget = 'any';
      i.budgetPerPerson = undefined;
    },
    label: 'Budget egal',
  },

  // ---- Zeit -----------------------------------------------------------
  {
    test: /\b(\d{1,2})\s*(?:-|bis)\s*(\d{1,2})\s*(?:stunden|std|h|hours)\b/i,
    apply: (i, m) => {
      const hi = Number(m[2]);
      if (Number.isFinite(hi)) i.availableMinutes = hi * 60;
    },
    label: (m) => `${m[1]}–${m[2]} Stunden`,
  },
  {
    test: /\b(\d{1,2}|eine|zwei|drei|vier|fünf|fuenf|sechs)\s*(?:stunden|stunde|std|h\b|hours|hour)/i,
    apply: (i, m) => {
      const n = toNumber(m[1]);
      if (n) i.availableMinutes = Math.round(n * 60);
    },
    label: (m) => `${toNumber(m[1]) ?? '?'} Stunden Zeit`,
  },
  {
    test: /\b(ganzer tag|den ganzen tag|whole day|all day)\b/i,
    apply: (i) => {
      i.availableMinutes = 480;
    },
    label: 'ganzer Tag',
  },
  {
    test: /\b(?:bis|um)\s*(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?\s*(?:wieder\s*)?(?:zu\s*hause|zuhause|daheim|home|back)\b/i,
    apply: (i, m) => {
      const h = Number(m[1]);
      const min = Number(m[2] ?? 0);
      if (Number.isFinite(h)) i.homeByMinutes = h * 60 + (Number.isFinite(min) ? min : 0);
    },
    label: (m) => `zuhause bis ${m[1]}:${m[2] ?? '00'} Uhr`,
  },
  {
    test: /\b(?:nur|hab(?:e)?|haben)\s*(?:noch\s*)?(\d{1,2})\s*(?:stunden|std|h)\b/i,
    apply: (i, m) => {
      const n = toNumber(m[1]);
      if (n) i.availableMinutes = n * 60;
    },
    label: (m) => `${m[1]} Stunden Zeit`,
  },
  {
    test: /\b(kurz|schnell|nicht lange|quick)\b/i,
    apply: (i) => {
      i.availableMinutes ??= 120;
    },
    label: 'eher kurz',
  },

  // ---- Stimmung -------------------------------------------------------
  {
    test: /\b(romantisch|romantic|verliebt|date.?abend|zweisamkeit)\b/i,
    apply: (i) => {
      addMood(i, 'date');
      i.party ??= 'partner';
    },
    label: 'romantisch',
  },
  {
    test: /\b(action|adrenalin|sportlich|aktiv|bewegen|krass|verrückt|verrueckt|crazy|wild)\b/i,
    apply: (i) => addMood(i, 'action'),
    label: 'Action',
  },
  {
    test: /\b(entspann|chill|ruhig|gemütlich|gemuetlich|relax|locker)\w*/i,
    apply: (i) => addMood(i, 'chill'),
    label: 'entspannt',
  },
  {
    test: /\b(party|feiern|tanzen|club|drinks|cocktails)\b/i,
    apply: (i) => addMood(i, 'party'),
    label: 'Party',
  },
  {
    test: /\b(essen|hunger|restaurant|dinner|lecker|food|abendessen)\b/i,
    apply: (i) => {
      addMood(i, 'food');
      i.focusCategory ??= 'food';
    },
    label: 'Essen',
  },
  {
    test: /\b(natur|draußen|draussen|grün|gruen|frische luft|spazier|wald|see|park)\w*/i,
    apply: (i) => addMood(i, 'nature'),
    label: 'Natur',
  },
  {
    test: /\b(gaming|zocken|konsole|vr|arcade)\b/i,
    apply: (i) => {
      addMood(i, 'gaming');
      i.focusCategory ??= 'gaming';
    },
    label: 'Gaming',
  },
  {
    test: /\b(neu|noch nie|was anderes|abwechslung|something new|mal was)\b/i,
    apply: (i) => {
      addMood(i, 'new');
      i.preferNovelty = true;
    },
    label: 'etwas Neues',
  },
  {
    test: /\b(kino|film|movie|cinema)\b/i,
    apply: (i) => {
      i.focusCategory = 'cinema';
    },
    label: 'Kino',
  },
  {
    test: /\b(café|cafe|kaffee|coffee|kuchen)\b/i,
    apply: (i) => {
      i.focusCategory ??= 'cafe';
    },
    label: 'Café',
  },
  {
    test: /\b(museum|ausstellung|kultur|theater)\b/i,
    apply: (i) => {
      i.focusCategory ??= 'culture';
    },
    label: 'Kultur',
  },

  // ---- Wetter / Ort ---------------------------------------------------
  {
    test: /\b(es regnet|regen|schlechtes wetter|raining|rainy|drinnen|indoor)\b/i,
    apply: (i) => {
      i.avoidOutdoor = true;
    },
    label: 'lieber drinnen',
  },
  {
    test: /\b(nicht weit|in der nähe|in der naehe|um die ecke|nah|close by|nearby|keine lust zu fahren)\b/i,
    apply: (i) => {
      i.maxDistanceMeters = 2500;
    },
    label: 'ganz in der Nähe',
  },

  // ---- Mobilität ------------------------------------------------------
  {
    test: /\b(zu fuß|zu fuss|laufen|walking|on foot)\b/i,
    apply: (i) => {
      i.mobility = 'walk';
    },
    label: 'zu Fuß',
  },
  {
    test: /\b(fahrrad|rad|bike|velo)\b/i,
    apply: (i) => {
      i.mobility = 'bike';
    },
    label: 'mit dem Rad',
  },
  {
    test: /\b(auto|wagen|car|fahren wir)\b/i,
    apply: (i) => {
      i.mobility = 'car';
    },
    label: 'mit dem Auto',
  },
  {
    test: /\b(bahn|öpnv|oepnv|bus|u-?bahn|s-?bahn|transit|public transport)\b/i,
    apply: (i) => {
      i.mobility = 'transit';
    },
    label: 'mit Bus & Bahn',
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

  async parse(text: string, _locale = 'de'): Promise<ParsedIntent> {
    const intent: Mutable = { moods: [], understood: [], confidence: 0 };
    if (!text.trim()) return intent;

    for (const rule of RULES) {
      const match = text.match(rule.test);
      if (!match) continue;
      rule.apply(intent, match);
      const label = typeof rule.label === 'function' ? rule.label(match) : rule.label;
      if (!intent.understood.includes(label)) intent.understood.push(label);
    }

    intent.confidence = Math.min(1, intent.understood.length / 4);
    return intent;
  }
}

export type { Party, Mood, Mobility, BudgetPreset, Category };
