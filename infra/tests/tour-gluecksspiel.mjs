/**
 * Der Tour-Pfad, gegen echte Daten.
 *
 * Warum nicht gegen die Attrappe: Die Sehenswuerdigkeiten-Abfrage verlangt
 * `["wikipedia"]`, und der Tourbau verwirft Kandidaten, die diese Huerde
 * nicht nehmen. Eine Attrappe dafuer zu bauen hiesse, den halben
 * Sights-Pfad nachzubilden - gegen echte Daten ist die Aussage staerker:
 * Rund um die Ackerstrasse liegen tatsaechlich Spielhallen und eine
 * Spielbank, die Tour darf keine davon enthalten.
 *
 * `candidatePool` im tourBuilder ist der einzige Kandidatenweg, der nicht
 * durch `passesHardFilters` laeuft. Genau dieser Weg wird hier geprueft.
 */
const B = process.env.BASIS ?? 'http://localhost:3000';
const ORT = { lat: 52.5375925, lon: 13.3864862, language: 'de', tzOffsetMin: 120, mobility: 'walk' };

let ok = 0, fail = 0, infra = 0; const bad = [];
const chk = (n, c, i = '') => {
  if (c === null) { infra += 1; console.log(`   INFRA ${n} – nicht messbar`); return; }
  if (c) { ok++; console.log(`   PASS  ${n}${i ? ' – ' + i : ''}`); }
  else { fail++; bad.push(`${n}${i ? ' – ' + i : ''}`); console.log(`   FAIL  ${n}${i ? ' – ' + i : ''}`); }
};
/**
 * Ein nicht erreichbarer Server ist kein Testergebnis, sondern ein
 * Aufrufsfehler - lesbare Meldung und Exit-Code 1 statt Stacktrace.
 */
function abbruch(fehler) {
  console.error(`\nServer nicht erreichbar: ${B}`);
  console.error(`Grund: ${fehler instanceof Error ? fehler.message : String(fehler)}`);
  console.error('Starte ihn mit `npm run dev` (Port 3000) oder setze BASIS.');
  process.exit(1);
}

const post = (u, b) =>
  fetch(B + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    .then((r) => r.json())
    .catch(abbruch);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const istGluecksspiel = (p) =>
  p.kind === 'Spielhalle' || p.kind === 'Spielbank' || p.gambling === true;

async function tour(extra = {}) {
  for (let v = 1; v <= 4; v += 1) {
    const r = await post('/api/plan', {
      ...ORT, mode: 'tour', availableMinutes: 240, searchRadiusMeters: 5000,
      startLocal: '14:00', party: 'friends', groupSize: 2, ...extra,
    });
    await warte(800);
    if (r.plan && r.plan.containsMockData !== true) return r.plan;
    await warte(3000);
  }
  return null;
}
const orte = (p) => (p?.steps ?? []).map((s) => `${s.place.name}[${s.place.kind}]`).join(' > ');

console.log('### Tour mit echten Daten');
const t = await tour();
chk('Kein Gluecksspiel in der Tour', t === null ? null : !t.steps.some((s) => istGluecksspiel(s.place)), orte(t) || 'keine Tour');

if (t) {
  let sauber = true; const gesehen = [];
  for (const hint of ['any', 'cheaper', 'new']) {
    for (const step of t.steps) {
      const r = await post(`/api/plan/${t.id}/replace`, { stepId: step.id, hint, language: 'de' });
      await warte(400);
      for (const s of r.plan?.steps ?? []) {
        gesehen.push(s.place.name);
        if (istGluecksspiel(s.place)) sauber = false;
      }
    }
  }
  chk('Station in der Tour ersetzen bietet kein Gluecksspiel', sauber,
    `${new Set(gesehen).size} verschiedene Orte ueber 3 Varianten`);
} else {
  chk('Station in der Tour ersetzen bietet kein Gluecksspiel', null);
}

console.log('\n### Gegenprobe: Liegt hier ueberhaupt Gluecksspiel?');
{
  const d = await post('/api/diagnose', {
    ...ORT, availableMinutes: 240, searchRadiusMeters: 5000, startLocal: '15:00',
    moods: ['action'], party: 'friends', groupSize: 2, top: 60,
  });
  await warte(500);
  if (d.error) { chk('Gluecksspiel liegt im Umkreis und ist gesperrt', null); }
  else {
    const alle = (d.slots ?? []).flatMap((s) => s.top);
    const g = alle.filter((x) => x.art === 'Spielhalle' || x.art === 'Spielbank');
    chk('Gluecksspiel liegt im Umkreis und ist gesperrt',
      d.gluecksspielGesperrt > 0 || g.length > 0
        ? g.every((x) => x.abgelehnt === 'gambling')
        : null,
      `gluecksspielGesperrt=${d.gluecksspielGesperrt}, als Kandidat sichtbar: ${g.length}, Gruende: ${[...new Set(g.map((x) => x.abgelehnt))].join(',') || '-'}`);
  }
}

console.log(`\n==== ${ok} PASS / ${fail} FAIL${infra ? ` / ${infra} nicht messbar` : ''} ====`);
bad.forEach((x) => console.log('  ! ' + x));
// Fehlgeschlagene Faelle muessen den Aufrufer erreichen.
if (fail > 0) process.exit(1);
