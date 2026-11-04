/**
 * Schritt 0: messen, nicht schaetzen.
 *
 * Wie viele Orte aus einem Geofabrik-Auszug taugen fuer WasJetzt, und wie
 * viel Platz brauchen sie? Das entscheidet, ob eine eigene Ortsdatenbank
 * auf Neon Free (1 GB) passt - vorher war es eine Vermutung.
 *
 *   node --experimental-strip-types infra/osm-import/messen.mts <datei.osm.pbf>
 */
import { leseKnoten, leseWege, type RohOrt, type RohWeg } from './pbfLeser.mts';
import { classify, istGluecksspiel } from '../../providers/osm/taxonomy.ts';

const pfad = process.argv[2];
if (!pfad) {
  console.error('Aufruf: node --experimental-strip-types infra/osm-import/messen.mts <datei.osm.pbf>');
  process.exit(1);
}

const jeProfil = new Map<string, number>();
let brauchbar = 0;
let gluecksspiel = 0;
let ohneName = 0;
let bytes = 0;

/** So viel Platz braucht ein Ort als Datensatz - grob, aber ehrlich gerechnet. */
function groesse(ort: { id: string; tags: Record<string, string> }, profil: string): number {
  const name = ort.tags.name ?? '';
  // id + profil + name + Koordinaten (2 x 8 Byte) + die Tags, die wir behalten.
  const behalten = ['opening_hours', 'fee', 'charge', 'website', 'phone', 'cuisine', 'outdoor_seating', 'wheelchair'];
  let t = 0;
  for (const k of behalten) if (ort.tags[k]) t += k.length + ort.tags[k].length + 4;
  return ort.id.length + profil.length + name.length + 16 + t + 24;
}

function zaehlen(ort: { id: string; tags: Record<string, string> }): void {
  const profil = classify(ort.tags);
  if (!profil) return;
  brauchbar += 1;
  if (istGluecksspiel(ort.tags)) gluecksspiel += 1;
  if (!ort.tags.name) ohneName += 1;
  jeProfil.set(profil, (jeProfil.get(profil) ?? 0) + 1);
  bytes += groesse(ort, profil);
}

console.log(`Datei: ${pfad}`);
const t0 = Date.now();

console.log('\n### Knoten');
const k = leseKnoten(pfad, (ort: RohOrt) => zaehlen(ort));
console.log(`  ${k.knoten.toLocaleString('de-DE')} Knoten gesamt`);
console.log(`  ${k.mitTags.toLocaleString('de-DE')} davon mit Tags`);

console.log('\n### Wege');
let wegKnoten = 0;
const w = leseWege(pfad, (weg: RohWeg) => {
  const profil = classify(weg.tags);
  if (!profil) return;
  wegKnoten += weg.knoten.length;
  zaehlen({ id: `way/${weg.id}`, tags: weg.tags });
});
console.log(`  ${w.wege.toLocaleString('de-DE')} Wege gesamt`);
console.log(`  ${w.mitTags.toLocaleString('de-DE')} davon mit Tags`);
console.log(`  ${wegKnoten.toLocaleString('de-DE')} Knotenverweise bei brauchbaren Wegen (fuer den Mittelpunkt)`);

console.log('\n### Brauchbar fuer WasJetzt');
console.log(`  ${brauchbar.toLocaleString('de-DE')} Orte mit Profil`);
console.log(`  ${ohneName.toLocaleString('de-DE')} davon ohne Namen`);
console.log(`  ${gluecksspiel.toLocaleString('de-DE')} als Gluecksspiel erkannt (werden gesperrt, nicht entfernt)`);
console.log(`  ~${(bytes / 1048576).toFixed(1)} MB Nutzdaten (ohne Index)`);

console.log('\n### Nach Profil');
for (const [profil, zahl] of [...jeProfil].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(zahl).padStart(6)}  ${profil}`);
}

console.log(`\nDauer: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
