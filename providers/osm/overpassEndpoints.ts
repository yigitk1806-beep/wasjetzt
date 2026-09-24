/**
 * Welche Overpass-Instanzen in welcher Reihenfolge gefragt werden.
 *
 * Hintergrund: Die öffentlichen Instanzen sind gespendete Infrastruktur.
 * Sie sind zeitweise überlastet, weisen Anfragen ab oder antworten so spät,
 * dass WasJetzt auf Schätzungen zurückfällt. Deshalb soll langfristig eine
 * eigene Instanz vorn stehen – die öffentlichen bleiben als Auffangnetz.
 *
 * Die Reihenfolge kommt aus der Umgebung, nicht aus dem Code:
 *
 *   OVERPASS_PRIMARY_URL    eigene Instanz (optional)
 *   OVERPASS_FALLBACK_URL   ein Ausweichziel (optional, sonst die Liste unten)
 *
 * Ohne beide Variablen verhält sich die App exakt wie bisher. Das ist
 * Absicht: Die Umstellung darf zu keinem Zeitpunkt etwas kaputt machen.
 */

/**
 * Öffentliche Overpass-Instanzen. Sie werden der Reihe nach probiert –
 * die Endpunkte sind gespendete Infrastruktur und zeitweise überlastet.
 */
export const OEFFENTLICHE_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

/** Große Abfragen an den Hauptserver dürfen dauern. */
const OEFFENTLICH_TIMEOUT_MS = 25_000;
/** Ausweichserver bekommen weniger Zeit – sie sind der zweite Versuch. */
const SPIEGEL_TIMEOUT_MS = 8000;
/**
 * Die eigene Instanz antwortet aus lokalen Daten. Wartet sie länger als das,
 * ist etwas kaputt, und die Zeit ist beim öffentlichen Server besser
 * angelegt als in weiterem Warten.
 */
const EIGEN_TIMEOUT_MS = 6000;

export type OverpassZiel = {
  url: string;
  /** Für Protokoll und Gesundheitsanzeige. */
  art: 'eigen' | 'öffentlich';
  timeoutMs: number;
  /**
   * Bei Überlast (429/504) ein zweites Mal denselben Server fragen.
   * Nur bei den öffentlichen sinnvoll: Dort ist Überlast der Normalfall,
   * bei der eigenen Instanz wäre es nur verlorene Zeit.
   */
  wiederholen: boolean;
};

function ausUmgebung(name: string): string | null {
  const wert = process.env[name]?.trim();
  if (!wert) return null;
  if (!/^https?:\/\//.test(wert)) {
    console.warn(`[overpass] ${name} ignoriert – keine http(s)-Adresse`);
    return null;
  }
  return wert.replace(/\/+$/, '');
}

function zahlAusUmgebung(name: string, standard: number): number {
  const wert = Number(process.env[name]);
  return Number.isFinite(wert) && wert > 0 ? wert : standard;
}

/**
 * Die Ziele in der Reihenfolge, in der sie gefragt werden.
 *
 * Wird bei jedem Aufruf neu gelesen: Auf Vercel ändert sich die Umgebung
 * nur beim Deployment, lokal soll ein Neustart des Servers reichen.
 */
export function overpassZiele(): OverpassZiel[] {
  const ziele: OverpassZiel[] = [];

  const eigen = ausUmgebung('OVERPASS_PRIMARY_URL');
  if (eigen) {
    ziele.push({
      url: eigen,
      art: 'eigen',
      timeoutMs: zahlAusUmgebung('OVERPASS_PRIMARY_TIMEOUT_MS', EIGEN_TIMEOUT_MS),
      wiederholen: false,
    });
  }

  const ausweich = ausUmgebung('OVERPASS_FALLBACK_URL');
  const oeffentlich = ausweich ? [ausweich] : [...OEFFENTLICHE_ENDPOINTS];

  oeffentlich.forEach((url, i) => {
    ziele.push({
      url,
      art: 'öffentlich',
      timeoutMs: i === 0 ? OEFFENTLICH_TIMEOUT_MS : SPIEGEL_TIMEOUT_MS,
      // Der erste öffentliche Server bekommt einen zweiten Versuch, solange
      // er der Hauptweg ist. Steht eine eigene Instanz davor, ist er schon
      // das Auffangnetz – dann zählt Tempo mehr als Hartnäckigkeit.
      wiederholen: i === 0 && !eigen,
    });
  });

  return ziele;
}

/** Nur der Host – für Protokollzeilen, ohne Pfad und ohne Parameter. */
export function hostVon(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unbekannt';
  }
}

export type OverpassZustand = {
  art: OverpassZiel['art'];
  host: string;
  status: 'healthy' | 'unhealthy' | 'timeout';
  ms: number;
  detail?: string;
};

/**
 * Kurzer Erreichbarkeitstest je Ziel – für die Gesundheitsseite.
 *
 * Bewusst die kleinstmögliche Abfrage: Sie belastet auch die öffentlichen
 * Instanzen kaum und sagt trotzdem, ob dort ein Overpass antwortet.
 */
export async function probeOverpass(timeoutMs = 5000): Promise<OverpassZustand[]> {
  const frage = '[out:json][timeout:5];out count;';

  return Promise.all(
    overpassZiele().map(async (ziel): Promise<OverpassZustand> => {
      const start = Date.now();
      try {
        const res = await fetch(ziel.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'WasJetzt/0.1 (Freizeitplaner; +https://wasjetzt.app)',
          },
          body: `data=${encodeURIComponent(frage)}`,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const ms = Date.now() - start;
        if (!res.ok) {
          return { art: ziel.art, host: hostVon(ziel.url), status: 'unhealthy', ms, detail: `HTTP ${res.status}` };
        }
        await res.json();
        return { art: ziel.art, host: hostVon(ziel.url), status: 'healthy', ms };
      } catch (error) {
        const ms = Date.now() - start;
        const abgelaufen = error instanceof Error && error.name === 'TimeoutError';
        return {
          art: ziel.art,
          host: hostVon(ziel.url),
          status: abgelaufen ? 'timeout' : 'unhealthy',
          ms,
          detail: error instanceof Error ? error.name : 'unbekannt',
        };
      }
    }),
  );
}
