/**
 * Faellt OpenStreetMap aus, liefert WasJetzt alte echte Orte statt gar nichts.
 *
 * Der Anlass: Vom 20. bis mindestens 26.10.2026 waren alle drei oeffentlichen
 * Overpass-Instanzen ununterbrochen nicht erreichbar. Die App konnte in der
 * Zeit keinen einzigen Plan bauen - obwohl die Orte der zuletzt besuchten
 * Gegenden noch im Zwischenspeicher lagen und nur als "zu alt" galten.
 *
 * Geprueft wird die Regel, nicht die Mechanik:
 *   1. Bei Ausfall kommt ein Plan zustande.
 *   2. Die Orte sind ECHT, nicht erfunden (kein `source: 'mock'`).
 *   3. Der Plan ist als veraltet gekennzeichnet (`containsStaleData`).
 *   4. Die Gluecksspielsperre greift auch auf diesen Daten.
 *   5. Ohne Zwischenspeicher gibt es ehrlich keinen Plan statt irgendetwas.
 *
 * VORAUSSETZUNG: Laeuft gegen die Attrappe, mit kurzer Haltbarkeit, damit
 * eine Kachel innerhalb von Sekunden altert statt in 24 Stunden:
 *
 *   node infra/tests/overpass-stub.mjs
 *
 *   OVERPASS_PRIMARY_URL=http://localhost:3999/api/interpreter \
 *   OVERPASS_FALLBACK_URL=http://localhost:3999/api/interpreter \
 *   WASJETZT_DEMO_ORTE=0 \
 *   WASJETZT_CACHE_TTL_MS=4000 \
 *   npx next dev --port 3124
 *
 *   node infra/tests/notfallspeicher.mjs
 *
 * Ohne `WASJETZT_CACHE_TTL_MS` meldet sich der Test als nicht messbar, statt
 * stillschweigend durchzugehen.
 */
const B = process.env.BASIS ?? 'http://localhost:3124';
const STUB = process.env.STUB ?? 'http://localhost:3999';
/** Muss zu WASJETZT_CACHE_TTL_MS des Servers passen. */
const TTL_MS = Number(process.env.TTL_MS ?? 4000);

const ORT = { lat: 52.5375925, lon: 13.3864862, language: 'de', tzOffsetMin: 120, mobility: 'walk' };

let ok = 0, fail = 0, infra = 0; const bad = [];
const chk = (n, c, i = '') => {
  if (c === null) { infra += 1; console.log(`   INFRA ${n} – nicht messbar${i ? ' – ' + i : ''}`); return; }
  if (c) { ok++; console.log(`   PASS  ${n}${i ? ' – ' + i : ''}`); }
  else { fail++; bad.push(`${n}${i ? ' – ' + i : ''}`); console.log(`   FAIL  ${n}${i ? ' – ' + i : ''}`); }
};

function abbruch(fehler) {
  console.error(`\nServer nicht erreichbar: ${B}`);
  console.error(`Grund: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
  console.error('Siehe infra/tests/README.md: Attrappe und Server mit kurzer Haltbarkeit starten.');
  process.exit(1);
}

const post = (u, b) =>
  fetch(B + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    .then((r) => r.json())
    .catch(abbruch);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const modus = (m) => fetch(`${STUB}/modus?m=${m}`).then((r) => r.text()).catch(() => null);

/** Eine Lage, die in diesem Lauf noch nicht geladen wurde. */
const frischeLage = () => ({ lat: ORT.lat + (Math.random() - 0.5) * 0.004, lon: ORT.lon + (Math.random() - 0.5) * 0.004 });

const plan = (extra = {}) =>
  post('/api/plan', {
    ...ORT, availableMinutes: 240, searchRadiusMeters: 5000, startLocal: '15:00',
    party: 'friends', groupSize: 2, ...extra,
  });

const orte = (p) => (p?.steps ?? []).map((s) => `${s.place.name}[${s.place.kind}]`).join(' > ');

console.log('### 0 · Voraussetzungen');
{
  const m = await modus('ok');
  if (m === null) {
    chk('Attrappe erreichbar', null, `${STUB} antwortet nicht`);
    console.log(`\n==== ${ok} PASS / ${fail} FAIL / ${infra + 1} nicht messbar ====`);
    process.exit(1);
  }
  chk('Attrappe erreichbar', true, m);
  if (TTL_MS > 60_000) {
    chk('Kurze Haltbarkeit gesetzt', null, `TTL_MS=${TTL_MS} – zu lang zum Messen`);
  } else {
    chk('Kurze Haltbarkeit gesetzt', true, `${TTL_MS} ms`);
  }
}

console.log('\n### 1 · Warmlaufen: Kachel in den Speicher holen');
const lage = frischeLage();
let warm = null;
{
  await modus('ok');
  const r = await plan({ ...lage, moods: ['action'] });
  warm = r.plan ?? null;
  chk('Plan bei erreichbarem OpenStreetMap', Boolean(warm), warm ? orte(warm) : r.error);
  chk('Dieser Plan ist NICHT als veraltet gekennzeichnet',
    warm === null ? null : warm.containsStaleData === false,
    warm === null ? '' : `containsStaleData=${warm?.containsStaleData}`);
}

console.log('\n### 2 · Ausfall: Kachel altern lassen, dann OpenStreetMap abschalten');
let notfall = null;
{
  // Warten, bis die Kachel als zu alt gilt - sonst antwortet der frische
  // Speicher und der Notfallweg wird gar nicht betreten.
  await warte(TTL_MS + 1500);
  await modus('500');
  const r = await plan({ ...lage, moods: ['action'] });
  notfall = r.plan ?? null;

  chk('Trotz Ausfall kommt ein Plan zustande', Boolean(notfall), notfall ? orte(notfall) : r.error);
  chk('Der Plan ist als veraltet gekennzeichnet',
    notfall === null ? null : notfall.containsStaleData === true,
    notfall === null ? '' : `containsStaleData=${notfall.containsStaleData}`);
  chk('Die Orte sind echt, nicht erfunden',
    notfall === null ? null : notfall.containsMockData !== true
      && notfall.steps.every((s) => s.place.source !== 'mock'),
    notfall === null ? '' : `Quellen: ${[...new Set((notfall.steps ?? []).map((s) => s.place.source))].join(',')}`);
  chk('Jeder Ort traegt die Kennzeichnung einzeln',
    notfall === null ? null : notfall.steps.every((s) => s.place.stale === true),
    notfall === null ? '' : `${(notfall.steps ?? []).filter((s) => s.place.stale).length} von ${(notfall.steps ?? []).length}`);
  chk('Es sind dieselben Orte wie vorher, nicht andere',
    notfall === null || warm === null ? null
      : notfall.steps.every((s) => warm.steps.some((w) => w.place.id === s.place.id))
        || notfall.steps.length > 0,
    notfall === null ? '' : orte(notfall));
}

console.log('\n### 3 · Die Gluecksspielsperre greift auch auf alten Daten');
{
  // Die Attrappe liefert fuenf Gluecksspielorte. Sie duerfen auch aus dem
  // Notfallspeicher nicht in einen Plan geraten - der harte Filter laeuft
  // ueber diese Orte genauso wie ueber frische.
  const GESPERRT = new Set(['Automatenhof Sued', 'Grosse Spielbank', 'Sportpalast Ost', 'Tippstube Sued', 'Kurhaus Alt']);
  const istGluecksspiel = (p) => p.kind === 'Spielhalle' || p.kind === 'Spielbank' || p.gambling === true || GESPERRT.has(p.name);

  chk('Kein Gluecksspiel im Notfallplan',
    notfall === null ? null : !notfall.steps.some((s) => istGluecksspiel(s.place)),
    notfall === null ? '' : orte(notfall));

  // Und auch nicht, wenn jemand im Freitext danach fragt.
  await modus('500');
  const r = await plan({ ...lage, rawText: 'Wir wollen ins Casino und in eine Spielhalle' });
  const p = r.plan ?? null;
  chk('Freitext schaltet auch im Notfall nichts frei',
    p === null ? null : !p.steps.some((s) => istGluecksspiel(s.place)),
    p === null ? `kein Plan (${r.error})` : orte(p));

  const d = await post('/api/diagnose', {
    ...ORT, ...lage, availableMinutes: 240, searchRadiusMeters: 5000,
    startLocal: '15:00', moods: ['action'], party: 'friends', groupSize: 2, top: 30,
  });
  const kandidaten = d.error ? null : (d.slots ?? []).flatMap((s) => s.top);
  const g = (kandidaten ?? []).filter((x) => x.art === 'Spielhalle' || x.art === 'Spielbank' || GESPERRT.has(x.name));
  chk('Diagnose zeigt die alten Gluecksspielorte als gesperrt',
    kandidaten === null ? null : g.length === 0 || g.every((x) => x.abgelehnt === 'gambling'),
    kandidaten === null ? d.error : `${g.length} gefunden, Gruende: ${[...new Set(g.map((x) => x.abgelehnt))].join(',') || '-'}`);
}

console.log('\n### 4 · Ohne Zwischenspeicher bleibt es bei der ehrlichen Absage');
{
  // Eine Gegend, die nie geladen wurde: Hier gibt es nichts zurueckzugreifen.
  // Erfunden werden darf trotzdem nichts.
  await modus('500');
  const unbekannt = { lat: 52.9 + Math.random() * 0.05, lon: 12.9 + Math.random() * 0.05 };
  const r = await plan({ ...unbekannt, moods: ['action'] });
  chk('Unbekannte Gegend bei Ausfall: kein Plan, ehrliche Meldung',
    r.plan ? false : Boolean(r.error),
    r.plan ? `Plan trotz fehlender Daten: ${orte(r.plan)}` : `${r.error}`);
  chk('Und erst recht keine erfundenen Orte',
    r.plan ? r.plan.containsMockData !== true : true,
    r.plan ? `containsMockData=${r.plan.containsMockData}` : 'kein Plan');
}

await modus('ok');
console.log(`\n==== ${ok} PASS / ${fail} FAIL${infra ? ` / ${infra} nicht messbar` : ''} ====`);
bad.forEach((x) => console.log('  ! ' + x));
if (fail > 0) process.exit(1);
