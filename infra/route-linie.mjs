/**
 * Die Route auf der Karte ist die echte Strassenfuehrung - nicht eine
 * gerade Verbindung zwischen den Stationen.
 *
 * Zwei Dinge koennen schiefgehen, und beide werden hier geprueft:
 *
 * 1. DATEN: Ein gerouteter Weg muss eine Geometrie mitbringen, und die muss
 *    eine Strassenfuehrung sein - also deutlich mehr als zwei Punkte, und
 *    laenger als die Luftlinie. Zwei Punkte waeren genau die gerade Linie,
 *    die es nicht sein darf.
 *
 * 2. DARSTELLUNG: Die Karte malt unter jede Linie einen weissen Rand.
 *    Wurden Rand und Linie je Teilstrecke zusammen gezeichnet, legte sich
 *    der 7px-Rand der naechsten Strecke ueber die 4px-Linie der vorigen -
 *    die Route riss an jeder Station sichtbar auf. Geprueft wird deshalb
 *    die Reihenfolge im DOM: erst alle Raender, dann alle Linien.
 *
 * Der zweite Teil braucht einen Browser und laeuft nur mit PRUEFE_DOM=1
 * zusammen mit dem Browserwerkzeug; ohne das meldet er sich als nicht
 * messbar, statt still durchzugehen.
 */
const B = process.env.BASIS ?? 'http://localhost:3123';
const ORT = { lat: 52.5375925, lon: 13.3864862, language: 'de', tzOffsetMin: 120, mobility: 'walk' };

let ok = 0, fail = 0, infra = 0; const bad = [];
const chk = (n, c, i = '') => {
  if (c === null) { infra += 1; console.log(`   INFRA ${n} – nicht messbar${i ? ' – ' + i : ''}`); return; }
  if (c) { ok++; console.log(`   PASS  ${n}${i ? ' – ' + i : ''}`); }
  else { fail++; bad.push(`${n}${i ? ' – ' + i : ''}`); console.log(`   FAIL  ${n}${i ? ' – ' + i : ''}`); }
};
const post = (u, b) => fetch(B + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/** Dieselbe Dekodierung wie in lib/wege.ts – bewusst nachgebaut, damit der
 *  Test nicht dasselbe kaputte Stueck Code benutzt, das er pruefen soll. */
function decode(encoded) {
  const punkte = []; let index = 0, lat = 0, lon = 0;
  const wert = () => {
    let ergebnis = 0, shift = 0, byte;
    do { byte = encoded.charCodeAt(index++) - 63; ergebnis |= (byte & 0x1f) << shift; shift += 5; }
    while (byte >= 0x20 && index < encoded.length);
    return ergebnis & 1 ? ~(ergebnis >> 1) : ergebnis >> 1;
  };
  while (index < encoded.length) { lat += wert(); lon += wert(); punkte.push([lat / 1e5, lon / 1e5]); }
  return punkte;
}
const meter = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

async function plan(body) {
  for (let v = 1; v <= 3; v += 1) {
    const r = await post('/api/plan', {
      ...ORT, availableMinutes: 240, searchRadiusMeters: 3000, startLocal: '15:00', ...body,
    });
    await warte(600);
    if (r.plan && r.plan.containsMockData !== true) return r.plan;
    if (!r.plan && r.error !== 'live-data-unavailable') return undefined;
    await warte(2500);
  }
  return null;
}

console.log('### 1 · Geroutete Wege tragen eine echte Strassenfuehrung');
const p = await plan({ moods: ['action'], party: 'friends', groupSize: 2 });
if (!p) {
  chk('Plan mit gerouteten Wegen', null, 'kein Plan');
} else {
  const wege = p.steps.map((s) => s.travelFromPrevious).filter((l) => l.distanceMeters > 0 || l.durationMin > 0);
  const echt = wege.filter((l) => !l.estimated);
  chk('Mindestens ein Weg ist echt geroutet', echt.length > 0, `${echt.length} von ${wege.length}`);

  for (const [i, leg] of echt.entries()) {
    chk(`Weg ${i}: Geometrie vorhanden`, Boolean(leg.geometry), leg.geometry ? `${leg.geometry.length} Zeichen` : 'FEHLT');
    if (!leg.geometry) continue;
    const punkte = decode(leg.geometry);
    // Eine gerade Verbindung haette genau zwei Punkte. Eine Strasse biegt ab.
    chk(`Weg ${i}: mehr als zwei Stuetzpunkte`, punkte.length > 2, `${punkte.length} Punkte`);
    // Und sie ist laenger als die Luftlinie zwischen Anfang und Ende.
    const luft = meter(punkte[0], punkte[punkte.length - 1]);
    const entlang = punkte.slice(1).reduce((sum, pt, k) => sum + meter(punkte[k], pt), 0);
    chk(`Weg ${i}: laeuft nicht schnurgerade`, entlang >= luft * 1.02,
      `${Math.round(entlang)}m entlang gegen ${Math.round(luft)}m Luftlinie`);
  }

  console.log('\n### 2 · Geschaetzte Wege geben keine Strasse vor');
  // Deterministisch statt zufaellig: Fuer den OEPNV hat OSRM kein Profil,
  // also faellt dort jeder Weg auf die geometrische Schaetzung zurueck.
  // Auf einen zufaellig gescheiterten Weg zu warten waere kein Test.
  const oepnv = await plan({ moods: ['action'], party: 'friends', groupSize: 2, mobility: 'transit' });
  if (!oepnv) {
    chk('Geschaetzte Wege tragen keine erfundene Geometrie', null, 'kein Plan');
  } else {
    const alleWege = oepnv.steps.map((s) => s.travelFromPrevious).filter((l) => l.distanceMeters > 0 || l.durationMin > 0);
    const g = alleWege.filter((l) => l.estimated);
    chk('OEPNV liefert geschaetzte Wege', g.length > 0, `${g.length} von ${alleWege.length}`);
    chk('Geschaetzte Wege tragen keine erfundene Geometrie',
      g.length === 0 ? null : g.every((l) => !l.geometry),
      `davon mit Geometrie: ${g.filter((l) => l.geometry).length}`);
    // Ohne Geometrie zeichnet die Karte gestrichelt - der sichtbare
    // Unterschied, auf den sich der Nutzer verlassen koennen muss.
    chk('Geschaetzte Wege sind als solche gekennzeichnet',
      g.length === 0 ? null : g.every((l) => l.estimated === true),
      `${g.length} mit estimated=true`);
  }

  console.log('\n### 3 · Die Geometrie ueberlebt das Speichern');
  const geladen = await fetch(`${B}/api/plan/${p.id}`).then((r) => r.json()).catch(() => null);
  const nachher = geladen?.plan?.steps?.map((s) => s.travelFromPrevious).filter((l) => !l.estimated) ?? [];
  chk('Gespeicherter Plan hat dieselben Geometrien',
    !geladen ? null : nachher.length === echt.length && nachher.every((l, i) => l.geometry === echt[i].geometry),
    `${nachher.filter((l) => l.geometry).length} von ${echt.length} mit Geometrie`);
}

console.log('\n### 4 · Zeichenreihenfolge auf der Karte');
if (process.env.PRUEFE_DOM !== '1') {
  chk('Erst alle weissen Raender, dann alle Linien', null, 'braucht einen Browser, PRUEFE_DOM=1');
} else {
  // Die Reihenfolge wird vom Browserwerkzeug in eine Datei geschrieben.
  const { readFileSync } = await import('node:fs');
  let reihen = null;
  try { reihen = JSON.parse(readFileSync(process.env.DOM_DATEI, 'utf8')); } catch { /* nicht da */ }
  if (!reihen) chk('Erst alle weissen Raender, dann alle Linien', null, 'keine Messung gefunden');
  else {
    // Kein weisser Rand darf nach der ersten farbigen Linie kommen.
    const ersteFarbige = reihen.findIndex((x) => x.stroke !== '#ffffff');
    const randDanach = reihen.slice(ersteFarbige + 1).some((x) => x.stroke === '#ffffff');
    chk('Erst alle weissen Raender, dann alle Linien', ersteFarbige >= 0 && !randDanach,
      reihen.map((x) => (x.stroke === '#ffffff' ? 'Rand' : 'Linie')).join(' '));
  }
}

console.log(`\n==== ${ok} PASS / ${fail} FAIL${infra ? ` / ${infra} nicht messbar` : ''} ====`);
bad.forEach((x) => console.log('  ! ' + x));
