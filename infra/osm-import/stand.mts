/**
 * Was liegt tatsaechlich in der Ortsdatenbank?
 *
 *   node --env-file=.env --import ./infra/aliasHaken.mjs \
 *     --experimental-strip-types infra/osm-import/stand.mts
 *
 * Bewusst ein eigener Blick in die Datenbank und nicht die Rueckmeldung des
 * Imports. Ein Import, der "18.130 Orte geschrieben" sagt und dessen
 * Verbindung dabei abgerissen ist, sagt dasselbe wie einer, der es getan
 * hat. Nur eine Abfrage danach belegt es.
 *
 * Endet mit Exit-Code 1, wenn die Tabelle leer ist - damit ein Lauf in
 * GitHub Actions rot wird, statt stillschweigend durchzugehen.
 */
import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ist nicht gesetzt. Starte mit --env-file=.env.');
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const orte = await prisma.osmPlace.count();
  const laeufe = await prisma.osmImport.findMany({ orderBy: { datenStand: 'desc' } });

  console.log(`Orte in der Datenbank: ${orte.toLocaleString('de-DE')}`);

  if (laeufe.length === 0) {
    console.log('Kein Gebiet importiert.');
  }

  for (const lauf of laeufe) {
    const tage = (Date.now() - lauf.datenStand.getTime()) / 86_400_000;
    console.log(
      `  ${lauf.gebiet}: ${lauf.orte.toLocaleString('de-DE')} Orte, ` +
        `Stand ${lauf.datenStand.toISOString().slice(0, 10)} (${tage.toFixed(1)} Tage alt)`,
    );
  }

  // Zwei Zahlen, die auseinanderlaufen koennen und es nicht sollen.
  const gemeldet = laeufe.reduce((s, l) => s + l.orte, 0);
  if (laeufe.length > 0 && gemeldet !== orte) {
    console.log(
      `\nHinweis: Die Laeufe melden ${gemeldet.toLocaleString('de-DE')} Orte, ` +
        `gezaehlt sind ${orte.toLocaleString('de-DE')}. ` +
        'Die Differenz sind Orte, die in zwei Gebieten liegen und nur einmal gespeichert wurden.',
    );
  }

  const gluecksspiel = await prisma.osmPlace.count({ where: { gambling: true } });
  const sichten = await prisma.osmPlace.count({ where: { sight: { not: null } } });
  console.log(`\n  davon ${sichten.toLocaleString('de-DE')} als Sehenswuerdigkeit nutzbar`);
  console.log(`  davon ${gluecksspiel.toLocaleString('de-DE')} als Gluecksspiel gesperrt`);

  if (orte === 0) {
    console.error('\nDie Tabelle ist leer - der Import hat nichts geschrieben.');
    process.exit(1);
  }
} finally {
  await prisma.$disconnect();
}
