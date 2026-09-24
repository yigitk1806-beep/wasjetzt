/**
 * Vergleicht eine Overpass-Instanz mit einer anderen – kalt, warm und unter
 * parallelen Anfragen.
 *
 * Gedacht für die Entscheidung "eigene Instanz nach vorn oder noch nicht".
 * Ein einzelner schneller Aufruf sagt darüber nichts; hier zählen Fehlerquote
 * und die langsamste Antwort unter Last.
 *
 * Aufruf:
 *   node infra/overpass/bench.mjs http://localhost:12345/api/interpreter
 *   node infra/overpass/bench.mjs <eigene> --vergleich https://overpass-api.de/api/interpreter
 *
 * Achtung: Die öffentlichen Instanzen sind gespendete Infrastruktur. Gegen
 * sie laufen deshalb nur die kleinen Stufen – die Parallelläufe ab 10
 * verweigert dieses Werkzeug für fremde Server bewusst.
 */

const ziele = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const vergleichIndex = process.argv.indexOf('--vergleich');
const vergleich = vergleichIndex > -1 ? process.argv[vergleichIndex + 1] : null;

if (ziele.length === 0) {
  console.error('Aufruf: node infra/overpass/bench.mjs <url> [--vergleich <url>]');
  process.exit(1);
}

/** Typische WasJetzt-Abfrage: Ausgehorte im 1,1-km-Kasten um Berlin-Mitte. */
function abfrage(lat, lon, radiusMeters) {
  const dLat = radiusMeters / 111_320;
  const dLon = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);
  const bbox = [
    (lat - dLat).toFixed(5), (lon - dLon).toFixed(5),
    (lat + dLat).toFixed(5), (lon + dLon).toFixed(5),
  ].join(',');
  return `[out:json][timeout:25][bbox:${bbox}];
nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|cinema)$"]["name"];
out center 300;`;
}

/** Mehrere Gegenden, damit nicht immer derselbe Zwischenspeicher antwortet. */
const ORTE = [
  ['Berlin-Mitte', 52.52, 13.405],
  ['Gesundbrunnen', 52.5487, 13.3889],
  ['Brandenburger Tor', 52.5163, 13.3777],
  ['Alexanderplatz', 52.5219, 13.4132],
  ['Kreuzberg', 52.4986, 13.4180],
];

async function einmal(url, [name, lat, lon], timeoutMs = 30_000) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'WasJetzt-Bench/0.1 (+https://wasjetzt.app)',
      },
      body: `data=${encodeURIComponent(abfrage(lat, lon, 1100))}`,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, ms: Date.now() - start, grund: `HTTP ${res.status}`, name };
    const json = await res.json();
    return { ok: true, ms: Date.now() - start, treffer: (json.elements ?? []).length, name };
  } catch (error) {
    return { ok: false, ms: Date.now() - start, grund: error.name, name };
  }
}

function auswerten(titel, ergebnisse) {
  const ok = ergebnisse.filter((e) => e.ok);
  const zeiten = ok.map((e) => e.ms).sort((a, b) => a - b);
  const mittel = zeiten.length ? Math.round(zeiten.reduce((a, b) => a + b, 0) / zeiten.length) : 0;
  const p50 = zeiten.length ? zeiten[Math.floor(zeiten.length / 2)] : 0;
  const max = zeiten.length ? zeiten[zeiten.length - 1] : 0;
  const quote = Math.round(((ergebnisse.length - ok.length) / ergebnisse.length) * 100);
  console.log(
    `   ${titel.padEnd(22)} ${String(ok.length + '/' + ergebnisse.length).padEnd(7)}` +
    ` Fehler ${String(quote + '%').padEnd(5)} Mittel ${String(mittel + 'ms').padEnd(9)}` +
    ` Median ${String(p50 + 'ms').padEnd(9)} Max ${max}ms`,
  );
  const fehler = ergebnisse.filter((e) => !e.ok);
  if (fehler.length) {
    const gruende = [...new Set(fehler.map((f) => f.grund))].join(', ');
    console.log(`   ${' '.repeat(22)} Gründe: ${gruende}`);
  }
  return { ok: ok.length, gesamt: ergebnisse.length, mittel, p50, max };
}

function istEigen(url) {
  return /localhost|127\.0\.0\.1|(^|\.)wasjetzt\./i.test(url);
}

async function messreihe(url) {
  console.log(`\n=== ${url}`);
  const eigen = istEigen(url);
  if (!eigen) {
    console.log('   (fremde Instanz – Parallelläufe über 5 werden ausgelassen)');
  }

  // Kalt: erste Abfrage einer Gegend.
  auswerten('kalt (1)', [await einmal(url, ORTE[0])]);
  // Warm: dieselbe Gegend gleich danach.
  auswerten('warm (3, nacheinander)', [
    await einmal(url, ORTE[0]),
    await einmal(url, ORTE[0]),
    await einmal(url, ORTE[0]),
  ]);

  const stufen = eigen ? [5, 10, 20] : [5];
  for (const n of stufen) {
    const anfragen = Array.from({ length: n }, (_, i) => einmal(url, ORTE[i % ORTE.length]));
    auswerten(`${n} parallel`, await Promise.all(anfragen));
    // Kurz Luft holen, damit die Stufen sich nicht überlagern.
    await new Promise((r) => setTimeout(r, 2000));
  }
}

for (const url of ziele) await messreihe(url);
if (vergleich) await messreihe(vergleich);
console.log('');
