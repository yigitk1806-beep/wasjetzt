/**
 * Gluecksspiel ist in WasJetzt vollstaendig ausgeschlossen.
 *
 * WARUM DIESE SUITE UMGESCHRIEBEN WURDE (11.10.2026)
 * Die vorige Fassung prueefte eine andere Regel: Spielhalle und Spielbank
 * waren auf ausdruecklichen Freitextwunsch erlaubt, nur ungefragt gesperrt.
 * Abschnitt 4 verlangte damals ausdruecklich, dass "Wir wollen in eine
 * Spielhalle" sie WIEDER als Kandidat zeigt. Genau das ist jetzt verboten:
 * Die App steht Kindern und Jugendlichen offen, deshalb gilt die Sperre
 * unabhaengig von Alter, Stimmung und Wunsch. Die betroffenen Faelle sind
 * umgedreht statt geloescht, damit die Hintertuer weiter geprueft wird -
 * nur mit der umgekehrten Erwartung.
 *
 * Laeuft gegen die Overpass-Attrappe, also deterministisch und ohne echte
 * Ortsdaten. Fixtures:
 *   Videohalle Nord   leisure=amusement_arcade                -> erlaubt
 *   Kegelbahn West    leisure=bowling_alley                   -> erlaubt
 *   Minigolf Mitte    leisure=miniature_golf                  -> erlaubt
 *   Sprungbude Nord   leisure=trampoline_park                 -> erlaubt
 *   Automatenhof Sued leisure=adult_gaming_centre             -> gesperrt
 *   Grosse Spielbank  amenity=casino                          -> gesperrt
 *   Sportpalast Ost   leisure=sports_centre + amenity=casino  -> gesperrt
 *   Tippstube Sued    leisure=sports_centre + shop=bookmaker  -> gesperrt
 *   Kurhaus Alt       tourism=attraction + amenity=casino     -> gesperrt
 *   Pruefmuseum       tourism=museum                          -> erlaubt
 *   Hoher Blick       tourism=viewpoint                       -> erlaubt
 *
 * Die letzten drei sind der Kern: Sie kommen ueber ein harmloses Zweit-Tag
 * herein. Eine gekuerzte Overpass-Abfrage allein wuerde sie nicht aufhalten.
 */
const B = process.env.BASIS ?? 'http://localhost:3124';
const STUB = process.env.STUB ?? 'http://localhost:3999';
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
  console.error('Siehe infra/tests/README.md: Attrappe und Server gegen die Attrappe starten.');
  process.exit(1);
}

const post = (u, b) =>
  fetch(B + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    .then((r) => r.json())
    .catch(abbruch);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/** Die Namen der Fixtures, die Gluecksspiel sind. */
const GESPERRT = new Set([
  'Automatenhof Sued', 'Grosse Spielbank', 'Sportpalast Ost', 'Tippstube Sued', 'Kurhaus Alt',
]);
/** Erkennung ueber Art UND Name: Die Art faellt weg, wenn ein Zweit-Tag
 *  gewinnt – dann verraet nur der Name, dass der Ort durchgerutscht ist. */
const istGluecksspiel = (p) =>
  p.kind === 'Spielhalle' || p.kind === 'Spielbank' || p.gambling === true || GESPERRT.has(p.name);
const istGluecksspielKandidat = (k) =>
  k.art === 'Spielhalle' || k.art === 'Spielbank' || GESPERRT.has(k.name);

async function diagnose(body) {
  for (let v = 1; v <= 3; v += 1) {
    const d = await post('/api/diagnose', { ...ORT, availableMinutes: 240, searchRadiusMeters: 5000, startLocal: '15:00', top: 30, ...body });
    await warte(500);
    if (!d.error) return d;
    await warte(2000);
  }
  return null;
}
const kandidaten = async (body) => {
  const d = await diagnose(body);
  return d ? (d.slots ?? []).flatMap((s) => s.top) : null;
};
async function plan(body) {
  for (let v = 1; v <= 3; v += 1) {
    const r = await post('/api/plan', { ...ORT, availableMinutes: 240, searchRadiusMeters: 5000, startLocal: '15:00', ...body });
    await warte(500);
    if (r.plan && r.plan.containsMockData !== true) return r.plan;
    if (!r.plan && r.error !== 'live-data-unavailable') return undefined;
    await warte(2000);
  }
  return null;
}
const orte = (p) => (p?.steps ?? []).map((s) => `${s.place.name}[${s.place.kind}]`).join(' > ');
/** Alle Orte eines Plans samt seiner Alternativvorschlaege. */
async function planUndGeschwister(body) {
  const p = await plan(body);
  if (!p) return { p, alle: [] };
  const alle = [...p.steps.map((s) => s.place)];
  for (const g of (p.siblings ?? []).filter((g) => g.id !== p.id)) {
    const r = await fetch(`${B}/api/plan/${g.id}`).then((x) => x.json()).catch(() => null);
    await warte(300);
    for (const s of r?.plan?.steps ?? []) alle.push(s.place);
  }
  return { p, alle };
}

console.log('### 1 · Erwachsene mit Stimmung „Action“');
{
  const k = await kandidaten({ moods: ['action'], party: 'friends', groupSize: 2 });
  const g = (k ?? []).filter((x) => istGluecksspielKandidat(x) && !x.abgelehnt);
  chk('Action: kein Casino, keine Spielhalle waehlbar',
    k === null ? null : g.length === 0,
    k === null ? '' : `${k.length} Kandidaten, davon moeglich: ${g.map((x) => x.name).join(',') || 'keins'}`);
  const p = await plan({ moods: ['action'], party: 'friends', groupSize: 2 });
  chk('Action: kein Gluecksspiel im Plan',
    p === null ? null : !(p?.steps ?? []).some((s) => istGluecksspiel(s.place)), orte(p) || 'kein Plan');
}

console.log('\n### 2 · Erwachsene mit „Gaming“');
{
  const k = await kandidaten({ focusCategory: 'gaming', party: 'friends', groupSize: 2 });
  const g = (k ?? []).filter((x) => istGluecksspielKandidat(x) && !x.abgelehnt);
  chk('Gaming: kein Casino, keine Spielhalle waehlbar',
    k === null ? null : g.length === 0,
    k === null ? '' : `${k.length} Kandidaten, davon moeglich: ${g.map((x) => x.name).join(',') || 'keins'}`);
  const p = await plan({ focusCategory: 'gaming', party: 'friends', groupSize: 2 });
  chk('Gaming: kein Gluecksspiel im Plan',
    p === null ? null : !(p?.steps ?? []).some((s) => istGluecksspiel(s.place)), orte(p) || 'kein Plan');
}

console.log('\n### 3 · Freitext hebt die Sperre NICHT auf');
for (const text of [
  'Wir wollen ins Casino',
  'Wir wollen in eine Spielhalle',
  'Lust auf Spielothek',
  'Wir wollen Gluecksspiel',
  'Wir wollen in die Spielbank und ins Kasino',
]) {
  const k = await kandidaten({ rawText: text, party: 'friends', groupSize: 2 });
  const g = (k ?? []).filter((x) => istGluecksspielKandidat(x) && !x.abgelehnt);
  chk(`Freitext „${text}“: nichts freigeschaltet`,
    k === null ? null : g.length === 0,
    k === null ? '' : `moeglich: ${g.map((x) => x.name).join(',') || 'keins'}`);
}
{
  const p = await plan({ rawText: 'Wir wollen unbedingt ins Casino, Spielhalle geht auch', party: 'friends', groupSize: 2 });
  chk('Freitext mit allen Wuenschen: kein Gluecksspiel im Plan',
    p === null ? null : !(p?.steps ?? []).some((s) => istGluecksspiel(s.place)), orte(p) || 'kein Plan');
}

console.log('\n### 4 · Familien mit Kindern');
for (const [name, extra] of [
  ['Familie            ', { focusCategory: 'gaming', party: 'family', groupSize: 4 }],
  ['Familie mit Kind 12', { focusCategory: 'gaming', party: 'family', groupSize: 4, age: 12 }],
  ['Familie + Freitext ', { rawText: 'Wir wollen ins Casino', party: 'family', groupSize: 4, age: 12 }],
]) {
  const k = await kandidaten(extra);
  const g = (k ?? []).filter((x) => istGluecksspielKandidat(x) && !x.abgelehnt);
  chk(`${name}: kein Gluecksspiel`,
    k === null ? null : g.length === 0,
    k === null ? '' : `moeglich: ${g.map((x) => x.name).join(',') || 'keins'}`);
}

console.log('\n### 5 · Station ersetzen');
{
  const p = await plan({ moods: ['action'], party: 'friends', groupSize: 2 });
  if (!p) { chk('Ersetzen bietet kein Gluecksspiel', null); }
  else {
    let sauber = true; const gesehen = [];
    for (const hint of ['any', 'cheaper', 'new']) {
      const r = await post(`/api/plan/${p.id}/replace`, { stepId: p.steps[0].id, hint, language: 'de' });
      await warte(400);
      for (const s of r.plan?.steps ?? []) {
        gesehen.push(s.place.name);
        if (istGluecksspiel(s.place)) sauber = false;
      }
    }
    chk('Ersetzen bietet kein Gluecksspiel', sauber, gesehen.join(', ') || '-');
  }
}

console.log('\n### 6 · Alternativvorschlaege (Geschwisterplaene)');
{
  const { p, alle } = await planUndGeschwister({ moods: ['action'], party: 'friends', groupSize: 2 });
  chk('Kein Gluecksspiel in irgendeinem Geschwisterplan',
    p === null ? null : !alle.some(istGluecksspiel),
    p === null ? '' : `${alle.length} Stationen ueber ${(p.siblings ?? []).length} Varianten`);
}

console.log('\n### 7 · Touren');
{
  const p = await plan({
    mode: 'tour', party: 'friends', groupSize: 2, availableMinutes: 300,
    interests: ['classic', 'hidden'],
  });
  chk('Kein Gluecksspiel in der Tour',
    p === null || p === undefined ? null : !(p?.steps ?? []).some(
      (s) => istGluecksspiel(s.place)), orte(p) || 'keine Tour');
  if (p) {
    let sauber = true; const gesehen = new Set(); const fehler = new Set();
    // Jede Station, jeder Hinweis: Mit wenigen Kandidaten antwortet die
    // Route sonst mit "no-alternative", und der Fall waere leer bestanden.
    for (const hint of ['any', 'cheaper', 'new']) {
      for (const step of p.steps) {
        const r = await post(`/api/plan/${p.id}/replace`, { stepId: step.id, hint, language: 'de' });
        await warte(300);
        if (r.error) { fehler.add(r.error); continue; }
        for (const s of r.plan?.steps ?? []) {
          gesehen.add(s.place.name);
          if (istGluecksspiel(s.place)) sauber = false;
        }
      }
    }
    chk('Station in der Tour ersetzen bietet kein Gluecksspiel',
      // Ohne einen einzigen gesehenen Ort waere das Bestehen wertlos.
      gesehen.size === 0 ? null : sauber,
      `${gesehen.size} Orte gesehen${fehler.size ? `, Absagen: ${[...fehler].join(',')}` : ''}`);
  } else {
    chk('Station in der Tour ersetzen bietet kein Gluecksspiel', null);
  }
}

console.log('\n### 8 · Gewoehnliche Freizeitangebote bleiben zulaessig');
{
  const k = await kandidaten({ focusCategory: 'gaming', party: 'family', groupSize: 4 });
  const moeglich = (k ?? []).filter((x) => !x.abgelehnt).map((x) => x.name);
  chk('Videospielhalle bleibt waehlbar – auch fuer Familien',
    k === null ? null : moeglich.includes('Videohalle Nord'),
    k === null ? '' : `moeglich: ${moeglich.join(', ') || 'keins'}`);
}
for (const [name, erwartet] of [
  ['Bowling      ', 'Kegelbahn West'],
  ['Minigolf     ', 'Minigolf Mitte'],
  ['Trampolinpark', 'Sprungbude Nord'],
]) {
  const k = await kandidaten({ moods: ['action'], party: 'family', groupSize: 4 });
  const moeglich = (k ?? []).filter((x) => !x.abgelehnt).map((x) => x.name);
  chk(`${name} bleibt waehlbar`,
    k === null ? null : moeglich.includes(erwartet),
    k === null ? '' : `moeglich: ${moeglich.join(', ') || 'keins'}`);
}

console.log('\n### 8b · `gambling=no` heisst das Gegenteil');
{
  // Eine Kneipe, die ausdruecklich keine Automaten hat, traegt in OSM
  // `gambling=no`. Wer nur auf das Vorhandensein des Tags prueft, sperrt
  // sie faelschlich - genau der Fehler, den diese Zeile verhindert.
  const k = await kandidaten({ sequence: ['bar'], party: 'friends', groupSize: 2, startLocal: '20:00', availableMinutes: 180 });
  const treffer = (k ?? []).filter((x) => x.name === 'Ehrliche Kneipe');
  chk('Kneipe mit `gambling=no` bleibt zulaessig',
    k === null ? null : treffer.length > 0 && treffer.some((x) => x.abgelehnt !== 'gambling'),
    k === null ? '' : treffer.length ? `Grund: ${treffer[0].abgelehnt ?? 'kein'}` : 'nicht im Kandidatenfeld');
}

console.log('\n### 9 · Diagnose erkennt die Sperre');
{
  const d = await diagnose({ focusCategory: 'gaming', party: 'friends', groupSize: 2 });
  const alle = d ? (d.slots ?? []).flatMap((s) => s.top) : [];
  const g = alle.filter(istGluecksspielKandidat);
  chk('Diagnose zeigt Gluecksspiel, aber mit Grund „gambling“',
    d === null ? null : g.length > 0 && g.every((x) => x.abgelehnt === 'gambling'),
    d === null ? '' : `${g.length} gefunden, Gruende: ${[...new Set(g.map((x) => x.abgelehnt))].join(',') || '-'}`);
  chk('Diagnose zaehlt die gesperrten Orte',
    d === null ? null : typeof d.gluecksspielGesperrt === 'number' && d.gluecksspielGesperrt > 0,
    d === null ? '' : `gluecksspielGesperrt = ${d?.gluecksspielGesperrt}`);
  chk('Das alte Feld „gluecksspielGewollt“ gibt es nicht mehr',
    d === null ? null : d.gluecksspielGewollt === undefined,
    d === null ? '' : `Wert: ${JSON.stringify(d?.gluecksspielGewollt)}`);
}

console.log('\n### 10 · Zweit-Tag-Faelle einzeln');
{
  const d = await diagnose({ moods: ['action'], party: 'friends', groupSize: 2 });
  const alle = d ? (d.slots ?? []).flatMap((s) => s.top) : [];
  for (const name of ['Sportpalast Ost', 'Tippstube Sued']) {
    const treffer = alle.filter((x) => x.name === name);
    chk(`${name} wird trotz harmlosem Zweit-Tag gesperrt`,
      d === null ? null : treffer.length === 0 || treffer.every((x) => x.abgelehnt === 'gambling'),
      d === null ? '' : treffer.length ? `Grund: ${treffer[0].abgelehnt}` : 'gar nicht erst im Kandidatenfeld');
  }
}

console.log('\n### 11 · Die Abfrage fragt Gluecksspiel gar nicht mehr ab');
{
  // Erst leeren, dann einen Planlauf an einer Stelle, die noch nicht im
  // Zwischenspeicher liegt - sonst fragt die App gar nicht erst nach und
  // die Sammlung bliebe leer. Die Zufallslage sorgt dafuer bei jedem Lauf.
  await fetch(`${STUB}/letzte?leeren=1`).catch(() => null);
  const frisch = { lat: 52.3 + Math.random() * 0.3, lon: 13.1 + Math.random() * 0.3 };
  await plan({ ...frisch, moods: ['action'], party: 'friends', groupSize: 2, searchRadiusMeters: 3000 });
  const q = await fetch(`${STUB}/letzte`).then((r) => r.text()).catch(() => null);
  const bloecke = q ? q.split('\n---\n').filter(Boolean).length : 0;
  chk('Overpass-Abfrage enthaelt kein „casino“',
    q === null || !q ? null : !/casino/i.test(q), q ? `${bloecke} Abfragen` : '');
  chk('Overpass-Abfrage enthaelt kein „adult_gaming_centre“',
    q === null || !q ? null : !/adult_gaming_centre/i.test(q), q ? `${bloecke} Abfragen` : '');
  chk('Gewoehnliche Freizeit wird weiter abgefragt',
    q === null || !q ? null : /amusement_arcade/.test(q) && /bowling_alley/.test(q) && /trampoline_park/.test(q) && /miniature_golf/.test(q),
    q ? `${bloecke} Abfragen` : '');
}

console.log(`\n==== ${ok} PASS / ${fail} FAIL${infra ? ` / ${infra} nicht messbar` : ''} ====`);
bad.forEach((x) => console.log('  ! ' + x));
// Fehlgeschlagene Faelle muessen den Aufrufer erreichen.
if (fail > 0) process.exit(1);
