import { NextResponse } from 'next/server';

/**
 * Begrenzt, wie oft eine Adresse teure Endpunkte aufrufen darf.
 *
 * Warum: Jede Planung löst Anfragen an gespendete Infrastruktur aus –
 * Overpass, OSRM, Photon, Wikipedia. Ein einzelnes Skript, das `/api/plan`
 * in einer Schleife aufruft, würde dort im Namen von WasJetzt Last erzeugen,
 * bis die Betreiber die App sperren. Das träfe dann alle Nutzer.
 *
 * Was das hier NICHT ist: ein verlässlicher Schutz gegen verteilte Angriffe.
 * Auf Vercel hat jede Instanz ihren eigenen Speicher, die Zähler gelten also
 * je Instanz. Gegen den häufigen Fall – ein Rechner, eine Schleife – reicht
 * das. Für mehr bräuchte es einen geteilten Zähler (Datenbank oder
 * Vercel-Firewall); offener Punkt in WASJETZ_PRODUCTION_CHECKLIST.md.
 *
 * Gespeichert wird nur ein Hash-freier Schlüssel aus Adresse und Endpunkt,
 * im Arbeitsspeicher, für höchstens ein Zeitfenster. Nichts davon wird
 * geschrieben oder protokolliert.
 */

type Fenster = { start: number; zahl: number };

const zaehler = new Map<string, Fenster>();
let letzteBereinigung = Date.now();

export type Regel = {
  /** Erlaubte Aufrufe je Fenster. */
  max: number;
  /** Fensterlänge in Millisekunden. */
  fensterMs: number;
};

/**
 * Großzügig genug, dass ein Mensch nie daran stößt: Wer zwanzig Pläne in
 * fünf Minuten baut, tippt nicht mehr, sondern lässt etwas laufen.
 */
export const REGELN = {
  planen: { max: 20, fensterMs: 5 * 60_000 },
  aendern: { max: 40, fensterMs: 5 * 60_000 },
  nachschlagen: { max: 120, fensterMs: 5 * 60_000 },
} satisfies Record<string, Regel>;

/** Die Adresse des Aufrufers, wie Vercel sie weiterreicht. */
function adresseVon(request: Request): string {
  const weitergeleitet = request.headers.get('x-forwarded-for');
  if (weitergeleitet) return weitergeleitet.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unbekannt';
}

/** Alte Fenster wegräumen, damit der Speicher nicht wächst. */
function bereinigen(jetzt: number) {
  if (jetzt - letzteBereinigung < 60_000) return;
  letzteBereinigung = jetzt;
  const laengstes = Math.max(...Object.values(REGELN).map((r) => r.fensterMs));
  for (const [schluessel, fenster] of zaehler) {
    if (jetzt - fenster.start > laengstes) zaehler.delete(schluessel);
  }
}

/**
 * `null`, wenn der Aufruf erlaubt ist – sonst die fertige 429-Antwort.
 *
 *   const gebremst = bremse(request, 'planen', REGELN.planen);
 *   if (gebremst) return gebremst;
 */
export function bremse(request: Request, name: string, regel: Regel): NextResponse | null {
  // Lokal und in Tests stört eine Bremse nur – dort laufen Regressions-
  // skripte bewusst viele Pläne hintereinander.
  if (process.env.WASJETZT_RATENBREMSE === '0') return null;
  if (process.env.NODE_ENV !== 'production' && process.env.WASJETZT_RATENBREMSE !== '1') return null;

  const jetzt = Date.now();
  bereinigen(jetzt);

  const schluessel = `${name}:${adresseVon(request)}`;
  const fenster = zaehler.get(schluessel);

  if (!fenster || jetzt - fenster.start >= regel.fensterMs) {
    zaehler.set(schluessel, { start: jetzt, zahl: 1 });
    return null;
  }

  fenster.zahl += 1;
  if (fenster.zahl <= regel.max) return null;

  const sekunden = Math.ceil((fenster.start + regel.fensterMs - jetzt) / 1000);
  return NextResponse.json(
    // Ein Code, den die Oberfläche übersetzt – wie bei allen anderen Fehlern.
    { error: 'rate-limited', params: { seconds: sekunden } },
    { status: 429, headers: { 'Retry-After': String(sekunden) } },
  );
}
