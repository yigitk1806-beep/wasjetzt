/**
 * Wie sich WasJetzt bei fremden Diensten vorstellt.
 *
 * OpenStreetMap, Overpass, OSRM und Nominatim laufen auf gespendeter
 * Infrastruktur, und ihre Nutzungsregeln verlangen eine identifizierbare
 * Anwendung mit erreichbarer Adresse. Wer sich nicht nennt, wird abgewiesen -
 * am 04.11.2026 antworteten zwei Overpass-Instanzen ohne User-Agent sofort
 * mit 429 und genau diesem Hinweis.
 *
 * Es stand hier einmal `+https://wasjetzt.app`. Diese Domain gehoert jemand
 * anderem - sie loest auf einen fremden Server auf. Wir haben den Betreibern
 * gespendeter Server also eine Kontaktadresse geschickt, die nicht zu uns
 * fuehrt. Das war kein Tippfehler mit kleiner Folge: Genau diese Adresse ist
 * der Weg, auf dem ein Betreiber sich bei Problemen meldet, statt zu sperren.
 *
 * Eine eigene Domain darf hier gern stehen, sobald es sie gibt - dann per
 * `WASJETZT_OEFFENTLICHE_URL`. Bis dahin gilt die echte Vercel-Adresse.
 */
const STANDARD_URL = 'https://wasjetzt-three.vercel.app';

function oeffentlicheUrl(): string {
  const eigen = process.env.WASJETZT_OEFFENTLICHE_URL?.trim();
  if (eigen && /^https?:\/\//.test(eigen)) return eigen.replace(/\/+$/, '');
  // Auf Vercel steht die Adresse des Deployments bereit. Besser als eine
  // falsche feste Adresse, auch wenn sie bei Vorschauen wechselt.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return STANDARD_URL;
}

/** Fuer alle ausgehenden Anfragen an fremde Dienste. */
export const WASJETZT_USER_AGENT = `WasJetzt/1.0 (Freizeitplaner; +${oeffentlicheUrl()})`;
