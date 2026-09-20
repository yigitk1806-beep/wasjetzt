import { NextResponse } from 'next/server';
import { getProviders } from '@/providers/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  // Bewusst nicht abgewartet: Der Client soll nicht blockieren.
  void providers.places.prefetch?.({ lat, lon });
  void providers.weather.forecast({ lat, lon }, 24).catch(() => undefined);

  return NextResponse.json({ started: true });
}
