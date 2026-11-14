/**
 * Die Ratenbremse bremst den, der übertreibt – und sonst niemanden.
 *
 * Läuft ohne Server und ohne Netz, rein deterministisch:
 *
 *   node --import ./infra/aliasHaken.mjs --experimental-strip-types \
 *     infra/tests/ratenbremse.mts
 *
 * Geprüft wird beides, was schiefgehen kann: dass zu viele Aufrufe
 * abgewiesen werden, und – genauso wichtig – dass ein normaler Nutzer, ein
 * anderer Nutzer oder ein anderer Endpunkt davon nicht getroffen werden.
 * Eine Bremse, die Unbeteiligte trifft, ist schlimmer als keine.
 */
process.env.WASJETZT_RATENBREMSE = '1';

const { bremse, REGELN } = await import('../../lib/ratenbremse.ts');

let ok = 0;
let fail = 0;
const schlecht: string[] = [];

function chk(name: string, bedingung: boolean, info = ''): void {
  if (bedingung) {
    ok += 1;
    console.log(`   PASS  ${name}${info ? ' – ' + info : ''}`);
  } else {
    fail += 1;
    schlecht.push(name);
    console.log(`   FAIL  ${name}${info ? ' – ' + info : ''}`);
  }
}

function anfrage(adresse: string): Request {
  return new Request('https://wasjetzt.test/api/plan', {
    method: 'POST',
    headers: { 'x-forwarded-for': `${adresse}, 10.0.0.1` },
  });
}

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log('### 1 · Bis zur Grenze erlaubt, danach abgewiesen');
{
  const regel = { max: 5, fensterMs: 60_000 };
  const ergebnisse = Array.from({ length: 5 }, () => bremse(anfrage('1.1.1.1'), 't1', regel));
  chk('Die ersten fünf Aufrufe gehen durch', ergebnisse.every((e) => e === null));

  const sechster = bremse(anfrage('1.1.1.1'), 't1', regel);
  chk('Der sechste wird mit 429 abgewiesen', sechster?.status === 429, `Status ${sechster?.status}`);

  const sekunden = Number(sechster?.headers.get('Retry-After'));
  chk('Retry-After nennt eine sinnvolle Wartezeit', sekunden > 0 && sekunden <= 60, `${sekunden} s`);

  const body = sechster ? await sechster.json() : null;
  chk('Fehlercode ist übersetzbar', body?.error === 'rate-limited', `error=${body?.error}`);
}

console.log('\n### 2 · Unbeteiligte werden nicht getroffen');
{
  const regel = { max: 2, fensterMs: 60_000 };
  bremse(anfrage('2.2.2.2'), 't2', regel);
  bremse(anfrage('2.2.2.2'), 't2', regel);
  chk('Erste Adresse ist gebremst', bremse(anfrage('2.2.2.2'), 't2', regel)?.status === 429);
  chk('Eine andere Adresse kommt durch', bremse(anfrage('3.3.3.3'), 't2', regel) === null);
  chk('Derselbe Nutzer an einem anderen Endpunkt kommt durch',
    bremse(anfrage('2.2.2.2'), 't2-anders', regel) === null);

  // Vercel hängt eigene Adressen hinten an `x-forwarded-for` an. Gezählt
  // werden darf nur die erste – sonst teilten sich alle Nutzer einen Zähler.
  chk('Nur die erste Adresse aus x-forwarded-for zählt',
    bremse(anfrage('4.4.4.4'), 't2', regel) === null, '10.0.0.1 am Ende ignoriert');
}

console.log('\n### 3 · Nach Ablauf des Fensters geht es wieder');
{
  const regel = { max: 1, fensterMs: 250 };
  bremse(anfrage('5.5.5.5'), 't3', regel);
  chk('Sofort danach gebremst', bremse(anfrage('5.5.5.5'), 't3', regel)?.status === 429);
  await warte(320);
  chk('Nach dem Fenster wieder frei', bremse(anfrage('5.5.5.5'), 't3', regel) === null);
}

console.log('\n### 4 · Abschaltbar für Tests und lokale Läufe');
{
  const regel = { max: 1, fensterMs: 60_000 };
  bremse(anfrage('6.6.6.6'), 't4', regel);
  process.env.WASJETZT_RATENBREMSE = '0';
  chk('WASJETZT_RATENBREMSE=0 bremst nie', bremse(anfrage('6.6.6.6'), 't4', regel) === null);
  process.env.WASJETZT_RATENBREMSE = '1';
}

console.log('\n### 5 · Ein Mensch stößt nie an die echte Grenze');
{
  // Zwölf Pläne in fünf Minuten sind schon ein sehr ungeduldiger Abend.
  // Die Grenze muss deutlich darüber liegen.
  chk('Planen: mindestens 15 je 5 Minuten', REGELN.planen.max >= 15 && REGELN.planen.fensterMs <= 5 * 60_000,
    `${REGELN.planen.max} je ${REGELN.planen.fensterMs / 60_000} min`);
  // Die Ortssuche feuert beim Tippen – jeder Buchstabe kann ein Aufruf sein.
  chk('Nachschlagen: großzügig genug fürs Tippen', REGELN.nachschlagen.max >= 100,
    `${REGELN.nachschlagen.max} je ${REGELN.nachschlagen.fensterMs / 60_000} min`);
}

console.log(`\n==== ${ok} PASS / ${fail} FAIL ====`);
schlecht.forEach((x) => console.log('  ! ' + x));
if (fail > 0) process.exit(1);
