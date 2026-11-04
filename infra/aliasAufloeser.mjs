/**
 * Loest Importe des App-Codes fuer Node auf - laeuft im Lade-Thread.
 *
 * Zwei Dinge schreibt der App-Code so, wie es ein Bundler erwartet, und
 * Node nicht versteht:
 *
 *   `@/providers/x`  - der Alias aus `paths` in der tsconfig
 *   `./openingHours` - ein relativer Pfad ohne Endung
 *
 * Beides wird hier aufgeloest, indem die ueblichen Endungen der Reihe nach
 * probiert werden. Damit laesst sich jede Datei der Anwendung direkt laden,
 * ohne sie vorher zu uebersetzen - und ohne dass der App-Code sich nach den
 * Werkzeugen richten muss, die ihn pruefen.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve as aufloesen } from 'node:path';

const WURZEL = aufloesen(dirname(fileURLToPath(import.meta.url)), '..');
const ENDUNGEN = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs'];

/** Der erste Pfad, der wirklich existiert - oder `null`. */
function ersterTreffer(roh) {
  if (existsSync(roh) && !existsSync(join(roh, 'package.json'))) {
    // Eine Datei mit Endung, die schon passt.
    const istVerzeichnis = ENDUNGEN.every((e) => !roh.endsWith(e));
    if (!istVerzeichnis) return roh;
  }
  for (const endung of ENDUNGEN) {
    const pfad = roh + endung;
    if (existsSync(pfad)) return pfad;
  }
  for (const endung of ENDUNGEN) {
    const pfad = join(roh, 'index' + endung);
    if (existsSync(pfad)) return pfad;
  }
  return null;
}

export function resolve(angabe, kontext, naechster) {
  let roh = null;

  if (angabe.startsWith('@/')) {
    roh = join(WURZEL, angabe.slice(2));
  } else if ((angabe.startsWith('./') || angabe.startsWith('../')) && kontext.parentURL?.startsWith('file:')) {
    // Hat die Angabe schon eine bekannte Endung, kommt Node allein zurecht.
    if (ENDUNGEN.some((e) => angabe.endsWith(e))) return naechster(angabe, kontext);
    roh = aufloesen(dirname(fileURLToPath(kontext.parentURL)), angabe);
  }

  if (roh === null) return naechster(angabe, kontext);

  const treffer = ersterTreffer(roh);
  if (treffer) return { url: pathToFileURL(treffer).href, shortCircuit: true };

  // Nicht gefunden: Node soll die eigene, aussagekraeftige Fehlermeldung
  // erzeugen, statt dass hier eine zweite daneben entsteht.
  return naechster(angabe, kontext);
}
