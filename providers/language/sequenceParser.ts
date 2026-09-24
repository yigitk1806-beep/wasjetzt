import type { SequenceKind } from '@/types/domain';

/**
 * Erkennt einen gewünschten Ablauf im Freitext.
 *
 * „Erst essen, dann Kino und danach noch einen Kaffee." soll ein Plan in
 * genau dieser Reihenfolge werden. Der Ansatz ist bewusst einfach und damit
 * verlässlich: Sagt der Satz überhaupt etwas über Reihenfolge („erst",
 * „danach", „zum Schluss"), dann gilt die Reihenfolge, in der die Dinge im
 * Satz vorkommen. Kein Raten, keine Umdeutung.
 *
 * Nennt jemand nur eine Position („das Essen soll auf jeden Fall zuerst
 * kommen"), ist das ein Vorspann – den Rest plant die Engine wie gewohnt.
 */

/**
 * Akzente weg, bevor gesucht wird.
 *
 * `\b` in JavaScript kennt nur ASCII-Buchstaben: Hinter dem „é" von „Café"
 * steht für die Wortgrenze keine Grenze, deshalb fand `\bcafé\b` das Wort
 * nie. Die Zerlegung trennt den Akzent ab und entfernt ihn; die Länge des
 * Textes bleibt dabei gleich, sodass die gefundenen Positionen weiter auf
 * den Originaltext passen.
 */
function ohneAkzente(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Wörter, die überhaupt erst eine Reihenfolge behaupten. */
const REIHENFOLGE_MARKER =
  /\b(erst|zuerst|als erstes|danach|dann|anschliessend|anschließend|spater|zum schluss|am ende|zuletzt|hinterher|first|then|afterwards|after that)\b/i;

/**
 * Was der Nutzer sagt → welche Position im Ablauf gemeint ist.
 * Geschrieben ohne Akzente, weil auch der Text ohne Akzente durchsucht wird.
 */
const BEGRIFFE: Array<{ kind: SequenceKind; test: RegExp }> = [
  {
    kind: 'cafe',
    test: /\b(cafes?|kaffee|kuchen|coffee|etwas ruhiges|was ruhiges|gemutlich(es)?)\b/gi,
  },
  {
    kind: 'food',
    test: /\b(essen gehen|abendessen|mittagessen|etwas essen|was essen|essen|restaurant|dinner|lunch|pizza|burger|sushi|italiener|dine)\b/gi,
  },
  {
    kind: 'bar',
    test: /\b(bar|kneipe|pub|cocktails?|drinks?|absacker|bier trinken)\b/gi,
  },
  {
    kind: 'action',
    test: /\b(action|bowling|kart(bahn|fahren)?|lasertag|escape ?room|escape|klettern|kletterhalle|minigolf|trampolin|arcade|paintball|axtwerfen|etwas unternehmen|was unternehmen|unternehmen|erlebnis)\b/gi,
  },
  { kind: 'cinema', test: /\b(kino|film|movie|cinema)\b/gi },
  { kind: 'culture', test: /\b(museum|galerie|ausstellung|kultur|theater|oper)\b/gi },
  { kind: 'shopping', test: /\b(shoppen|shopping|einkaufen|bummeln|mall|einkaufszentrum)\b/gi },
  { kind: 'wellness', test: /\b(wellness|spa|sauna|massage|therme)\b/gi },
  { kind: 'gaming', test: /\b(gaming|zocken|spielhalle|vr|billard)\b/gi },
  { kind: 'sport', test: /\b(schwimmen|schwimmbad|eislaufen|eisbahn|sport)\b/gi },
  { kind: 'nature', test: /\b(park|natur|spaziergang|spazieren|draussen|draußen|grillen)\b/gi },
];

/** Mehr als fünf Stationen trägt kein Abend. */
const MAX = 5;

export function parseSequence(text: string): SequenceKind[] | undefined {
  const sauber = ohneAkzente(text);
  if (!REIHENFOLGE_MARKER.test(sauber)) return undefined;

  // Alle Treffer mit ihrer Position im Satz sammeln.
  const treffer: Array<{ kind: SequenceKind; at: number }> = [];
  for (const { kind, test } of BEGRIFFE) {
    for (const m of sauber.matchAll(test)) {
      if (m.index === undefined) continue;
      treffer.push({ kind, at: m.index });
    }
  }
  if (treffer.length === 0) return undefined;

  treffer.sort((a, b) => a.at - b.at);

  // Je Art zählt nur das erste Vorkommen – „Café" und „gemütlich" im selben
  // Satzteil meinen dieselbe Station.
  const folge: SequenceKind[] = [];
  for (const t of treffer) {
    if (folge.includes(t.kind)) continue;
    folge.push(t.kind);
    if (folge.length >= MAX) break;
  }

  return folge;
}
