import type { Plan, TravelLeg } from '@/types/domain';

/**
 * Kodierte Polyline (Google-Format, Genauigkeit 1e-5, so liefert OSRM sie mit
 * `geometries=polyline`) → Liste von [Breite, Länge].
 */
export function decodePolyline(encoded: string): Array<[number, number]> {
  const punkte: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const naechsterWert = (): number => {
    let ergebnis = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      ergebnis |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    return ergebnis & 1 ? ~(ergebnis >> 1) : ergebnis >> 1;
  };

  while (index < encoded.length) {
    lat += naechsterWert();
    lon += naechsterWert();
    punkte.push([lat / 1e5, lon / 1e5]);
  }
  return punkte;
}

export type WegSumme = {
  meter: number;
  minuten: number;
  /** all = jede Strecke echt geroutet, none = nur Luftlinie, some = gemischt. */
  routing: 'all' | 'some' | 'none';
};

/**
 * Gesamtweg eines Plans – alle Teilstrecken plus Rückweg. Ob die Zahl echte
 * Wege oder Luftlinie ist, steht dabei: Geschätzte Strecken sind die direkte
 * Entfernung zwischen zwei Punkten.
 */
export function wegSumme(plan: Pick<Plan, 'steps' | 'returnHome'>): WegSumme {
  const legs: Array<Pick<TravelLeg, 'distanceMeters' | 'durationMin' | 'estimated'>> = [
    ...plan.steps.map((s) => s.travelFromPrevious),
    ...(plan.returnHome ? [plan.returnHome] : []),
  ].filter((leg) => leg.distanceMeters > 0 || leg.durationMin > 0);

  const echt = legs.filter((leg) => !leg.estimated).length;
  return {
    meter: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
    minuten: legs.reduce((sum, leg) => sum + leg.durationMin, 0),
    routing: legs.length === 0 || echt === legs.length ? 'all' : echt === 0 ? 'none' : 'some',
  };
}
