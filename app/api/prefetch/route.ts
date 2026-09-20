import { NextResponse } from 'next/server';
import { getProviders } from '@/providers/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Overpass braucht je nach Auslastung bis zu 25 Sekunden. Ohne dieses Limit
 * würde die Plattform die Funktion vorher abbrechen und der Cache bliebe leer.
 */
export const maxDuration = 60;

/**
 * Wärmt den Ortscache für die Umgebung des Nutzers vor.
 *
 * Die öffentlichen OpenStreetMap-Instanzen brauchen für eine Stadtabfrage
 * je nach Auslastung 5–20 Sekunden. Damit „Jetzt los" trotzdem sofort
 * echte Daten hat, startet die App diese Abfrage schon beim Öffnen –
 * also während der Nutzer die Startseite liest.
 *
 * Die Antwort kommt sofort; geladen wird im Hintergrund.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    /* leerer Body ist erlaubt */
  }

  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'lat/lon fehlen.' }, { status: 400 });
  }

  const providers = getProviders();

  // Hier wird bewusst gewartet, bis die Daten im Cache liegen.
  //
  // Auf einer serverlosen Plattform endet die Funktion mit der Antwort –
  // alles, was danach noch laufen sollte, wird eingefroren. Ein "im
  // Hintergrund weiterladen" gibt es dort nicht.
  //
  // Für den Nutzer ändert das nichts: Die Startseite schickt diese Anfrage
  // ab und wartet nicht auf die Antwort.
  const start = Date.now();
  await Promise.all([
    providers.places.prefetch?.({ lat, lon }) ?? Promise.resolve(),
    providers.weather.forecast({ lat, lon }, 24).catch(() => undefined),
  ]);

  return NextResponse.json({ ready: true, dauerMs: Date.now() - start });
}
