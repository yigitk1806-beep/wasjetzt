/**
 * Importiert einen Geofabrik-Auszug in die eigene Ortsdatenbank.
 *
 *   node --env-file=.env --experimental-strip-types \
 *     infra/osm-import/importieren.mts <datei.osm.pbf> <gebiet> [--trocken]
 *
 * Beispiel:
 *   node --env-file=.env --experimental-strip-types \
 *     infra/osm-import/importieren.mts berlin.osm.pbf europe/germany/berlin
 *
 * `--trocken` rechnet alles durch und schreibt nichts. Gut fuer den ersten
 * Blick auf einen neuen Auszug.
 *
 * Was hier bewusst NICHT passiert:
 *
 *   Erfinden. Ein Ort ohne Namen wird nicht benannt, ein fehlender Preis
 *   nicht geschaetzt, eine fehlende Oeffnungszeit nicht ergaenzt. Faellt ein
 *   Ort durch die Klassifizierung, bleibt er draussen.
 *
 *   Eigene Logik. Welches Profil ein Ort bekommt, entscheidet
 *   `taxonomy.ts` - dieselbe Datei, die auch die Overpass-Antworten
 *   verarbeitet. Dieses Skript ordnet nichts selbst zu.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { leseKnoten, leseWege, leseKoordinaten, type RohOrt, type RohWeg } from './pbfLeser.mts';
import { classify, istGluecksspiel, type OsmTags } from '../../providers/osm/taxonomy.ts';
import { classifySight } from '../../providers/osm/sights.ts';

const [, , pfad, gebiet, ...rest] = process.argv;
const trocken = rest.includes('--trocken');

if (!pfad || !gebiet) {
  console.error('Aufruf: importieren.mts <datei.osm.pbf> <gebiet> [--trocken]');
  console.error('Beispiel: importieren.mts berlin.osm.pbf europe/germany/berlin');
  process.exit(1);
}

if (!trocken && !process.env.DATABASE_URL) {
  // Bewusst ohne den Wert selbst: Zugangsdaten gehoeren nicht in Logs.
  console.error('DATABASE_URL ist nicht gesetzt. Starte mit --env-file=.env oder nutze --trocken.');
  process.exit(1);
}

type Satz = {
  id: string;
  lat: number;
  lon: number;
  name: string;
  /** Ausgehort-Profil, falls der Ort eines ist. */
  profil: string | null;
  /** Sehenswuerdigkeits-Profil, falls der Ort eines ist. */
  sight: string | null;
  gambling: boolean;
  tags: OsmTags;
};

/** Ein Ort, der in die Datenbank darf - oder `null`, mit Grund. */
function pruefen(id: string, lat: number, lon: number, tags: OsmTags): Satz | null {
  // Zwei Fragen, nicht eine: Taugt der Ort zum Ausgehen, taugt er als
  // Sehenswuerdigkeit? Beides wird getrennt beantwortet, weil `classifySight`
  // `historic=*`-Tags annimmt, die `classify` ablehnt. Nur nach `classify` zu
  // filtern hat im Probelauf 609 Berliner Sehenswuerdigkeiten verschluckt -
  // 306 Kirchen, 96 Bruecken, den Dom.
  const profil = classify(tags);
  const sight = classifySight(tags);
  if (!profil && !sight) return null;
  // Ohne Namen laesst sich der Ort nicht anzeigen, und erfunden wird keiner.
  // `toPlace` wuerde ihn ohnehin verwerfen - dann besser gar nicht speichern.
  if (!tags.name) return null;
  // Dauerhaft geschlossen, im Bau, nicht oeffentlich: dieselben Regeln wie
  // in `toPlace`, hier nur frueher angewandt, um Platz zu sparen.
  if (tags['disused:amenity'] || tags.abandoned || tags.construction) return null;
  if (tags.access === 'private' || tags.access === 'no') return null;

  return {
    id,
    lat,
    lon,
    name: tags.name,
    profil,
    sight,
    gambling: istGluecksspiel(tags),
    tags,
  };
}

console.log(`Auszug:  ${pfad}`);
console.log(`Gebiet:  ${gebiet}`);
if (trocken) console.log('Modus:   TROCKEN - es wird nichts geschrieben');

const t0 = Date.now();

/* ---------------------------------------------------------------- *
 * 1. Pruefsumme und Stand - damit nachvollziehbar bleibt, was drin ist.
 * ---------------------------------------------------------------- */
const md5 = createHash('md5').update(readFileSync(pfad)).digest('hex');
const datenStand = statSync(pfad).mtime;
console.log(`md5:     ${md5}`);
console.log(`Stand:   ${datenStand.toISOString()}`);

/* ---------------------------------------------------------------- *
 * 2. Knoten.
 * ---------------------------------------------------------------- */
const saetze: Satz[] = [];
console.log('\nKnoten lesen ...');
const k = leseKnoten(pfad, (ort: RohOrt) => {
  const satz = pruefen(ort.id, ort.lat, ort.lon, ort.tags);
  if (satz) saetze.push(satz);
});
console.log(`  ${k.knoten.toLocaleString('de-DE')} Knoten, ${saetze.length.toLocaleString('de-DE')} brauchbar`);

/* ---------------------------------------------------------------- *
 * 3. Wege. Die Koordinate ist der Mittelpunkt ihrer Knoten, also
 *    braucht es einen zweiten Durchgang fuer genau diese Knoten.
 * ---------------------------------------------------------------- */
console.log('\nWege lesen ...');
const kandidaten: RohWeg[] = [];
const gesucht = new Set<number>();
const w = leseWege(pfad, (weg: RohWeg) => {
  // Erst grob pruefen - ohne Koordinate, die kommt im zweiten Durchgang.
  if (!weg.tags.name) return;
  if (!classify(weg.tags) && !classifySight(weg.tags)) return;
  if (weg.knoten.length === 0) return;
  kandidaten.push(weg);
  for (const n of weg.knoten) gesucht.add(n);
});
console.log(`  ${w.wege.toLocaleString('de-DE')} Wege, ${kandidaten.length.toLocaleString('de-DE')} Kandidaten`);
console.log(`  ${gesucht.size.toLocaleString('de-DE')} Knotenkoordinaten gesucht`);

const koordinaten = leseKoordinaten(pfad, gesucht);
console.log(`  ${koordinaten.size.toLocaleString('de-DE')} davon gefunden`);

let ohneKoordinate = 0;
for (const weg of kandidaten) {
  let summeLat = 0;
  let summeLon = 0;
  let zahl = 0;
  for (const n of weg.knoten) {
    const punkt = koordinaten.get(n);
    if (!punkt) continue;
    summeLat += punkt[0];
    summeLon += punkt[1];
    zahl += 1;
  }
  // Liegt ein Weg teilweise ausserhalb des Auszugs, fehlen seine Knoten.
  // Dann gibt es keinen ehrlichen Mittelpunkt - also keinen Ort.
  if (zahl === 0) {
    ohneKoordinate += 1;
    continue;
  }
  const satz = pruefen(`way/${weg.id}`, summeLat / zahl, summeLon / zahl, weg.tags);
  if (satz) saetze.push(satz);
}
if (ohneKoordinate > 0) {
  console.log(`  ${ohneKoordinate} Wege ohne Knoten im Auszug - uebersprungen`);
}

/* ---------------------------------------------------------------- *
 * 4. Zusammenfassung.
 * ---------------------------------------------------------------- */
const gluecksspiel = saetze.filter((s) => s.gambling).length;
const jeProfil = new Map<string, number>();
for (const s of saetze) {
  const schluessel = s.profil ?? `sicht:${s.sight}`;
  jeProfil.set(schluessel, (jeProfil.get(schluessel) ?? 0) + 1);
}
const nurSicht = saetze.filter((s) => !s.profil && s.sight).length;

console.log(`\n${saetze.length.toLocaleString('de-DE')} Orte insgesamt`);
console.log(`  davon ${gluecksspiel} als Gluecksspiel markiert (gespeichert und gesperrt, nicht entfernt)`);
console.log(`  davon ${nurSicht} ausschliesslich Sehenswuerdigkeit (Kirchen, Bruecken, Denkmaeler)`);
console.log(`  ${jeProfil.size} verschiedene Profile`);

const bytes = saetze.reduce((s, o) => s + JSON.stringify(o).length, 0);
console.log(`  ~${(bytes / 1048576).toFixed(1)} MB als JSON`);

if (trocken) {
  console.log(`\nTrockenlauf fertig in ${((Date.now() - t0) / 1000).toFixed(1)} s. Nichts geschrieben.`);
  process.exit(0);
}

/* ---------------------------------------------------------------- *
 * 5. Schreiben. Alter und neuer Lauf wechseln in einer Transaktion -
 *    die App sieht zu keinem Zeitpunkt einen halben oder leeren Bestand.
 * ---------------------------------------------------------------- */
const prisma = new PrismaClient();
const importId = `${gebiet.replace(/\//g, '-')}-${datenStand.toISOString().slice(0, 10)}-${md5.slice(0, 8)}`;

try {
  const vorhanden = await prisma.osmImport.findUnique({ where: { id: importId } });
  if (vorhanden) {
    console.log(`\nDieser Auszug liegt schon in der Datenbank (${importId}). Nichts zu tun.`);
    process.exit(0);
  }

  console.log(`\nSchreibe als ${importId} ...`);

  // Alles in EINER Transaktion: alten Lauf loeschen, neuen schreiben.
  //
  // Die erste Fassung schrieb erst den neuen Lauf mit `skipDuplicates` und
  // loeschte danach den alten. Das leerte beim zweiten Lauf die Datenbank:
  // Fast jeder Ort existierte schon unter derselben Kennung, wurde deshalb
  // uebersprungen, blieb am alten Lauf haengen - und ging mit ihm per
  // Cascade unter. Uebrig blieb nur, was seit dem letzten Monat neu war.
  //
  // In der Transaktion sehen lesende Anfragen bis zum Abschluss den alten
  // Bestand (Postgres zeigt unfertige Transaktionen nicht). Scheitert
  // etwas, bleibt der alte Bestand ganz erhalten.
  const geschrieben = await prisma.$transaction(
    async (tx) => {
      const alt = await tx.osmImport.deleteMany({ where: { gebiet } });
      if (alt.count > 0) console.log(`  ${alt.count} aelteren Lauf/Laeufe desselben Gebiets ersetzt`);

      await tx.osmImport.create({
        data: { id: importId, gebiet, datenStand, md5, orte: saetze.length },
      });

      const BUENDEL = 2000;
      let zahl = 0;
      for (let i = 0; i < saetze.length; i += BUENDEL) {
        const teil = saetze.slice(i, i + BUENDEL);
        const ergebnis = await tx.osmPlace.createMany({
          data: teil.map((s) => ({
            id: s.id,
            lat: s.lat,
            lon: s.lon,
            name: s.name,
            profil: s.profil,
            sight: s.sight,
            gambling: s.gambling,
            tags: s.tags,
            importId,
          })),
          // Ein Weg an der Grenze kann in zwei Auszuegen stehen (Berlin und
          // Brandenburg). Dann gehoert er dem Gebiet, das zuerst kam.
          skipDuplicates: true,
        });
        zahl += ergebnis.count;
        process.stdout.write(`\r  ${zahl.toLocaleString('de-DE')} von ${saetze.length.toLocaleString('de-DE')}`);
      }
      console.log();
      return zahl;
    },
    // Zehntausende Zeilen brauchen laenger als die Vorgabe von 5 s.
    { timeout: 10 * 60_000, maxWait: 30_000 },
  );

  const uebersprungen = saetze.length - geschrieben;
  if (uebersprungen > 0) {
    console.log(`  ${uebersprungen} Orte gehoeren schon einem anderen Gebiet (Grenzlage)`);
  }

  console.log(`\nFertig in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
} finally {
  await prisma.$disconnect();
}
