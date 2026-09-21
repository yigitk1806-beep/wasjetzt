'use client';

import { useEffect, useRef } from 'react';
import type * as LeafletNS from 'leaflet';
import { formatDistance, haversineMeters } from '@/lib/geo';
import { formatDuration } from '@/lib/time';
import { decodePolyline, wegSumme } from '@/lib/wege';
import type { Coordinates, Mobility, Plan, PlanStep } from '@/types/domain';
import 'leaflet/dist/leaflet.css';

type Props = {
  origin: Coordinates;
  steps: PlanStep[];
  mobility: Mobility;
  /** Rückweg, falls eine Heimkehrzeit gesetzt ist. */
  returnHome?: Plan['returnHome'];
  home?: Coordinates;
};

/**
 * Kartenkacheln. Standard ist der offizielle OSM-Tileserver; er ist für
 * moderate Nutzung gedacht. Für echten Traffic gehört hier ein eigener
 * oder bezahlter Anbieter hin – deshalb über Umgebungsvariable austauschbar,
 * ohne Codeänderung.
 */
const TILE_URL =
  process.env.NEXT_PUBLIC_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_TILE_ATTRIBUTION ?? '&copy; OpenStreetMap';

const ORANGE = '#f15c1c';

const UNTERWEGS: Record<Mobility, string> = {
  walk: 'zu Fuß',
  bike: 'mit dem Rad',
  transit: 'mit Bus & Bahn',
  car: 'mit dem Auto',
};

/**
 * Echte Karte der Stationen. Leaflet wird erst im Browser geladen (~42 kB),
 * damit die Plan-Seite sofort sichtbar ist und die Karte nachrückt.
 *
 * Jede Teilstrecke wird einzeln gezeichnet – mit der echten Wegführung aus
 * dem Routing, also genau dem Weg, aus dem Gehstrecke und Gehzeit stammen.
 * Nur wo es kein Routing gibt (etwa Bus & Bahn), steht eine gestrichelte
 * Luftlinie, und die Beschriftung sagt das auch.
 */
export function PlanMap({ origin, steps, mobility, returnHome, home }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    void (async () => {
      const L = await import('leaflet');
      if (cancelled || !containerRef.current) return;

      // Bei Re-Renders die alte Instanz sauber abräumen.
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const map = L.map(container, {
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: false,
        // Feinere Zoomstufen: Die Tour füllt die Karte, statt in der Mitte
        // eines viel zu großen Ausschnitts zu liegen.
        zoomSnap: 0.25,
        // Auf dem Handy soll die Seite scrollen, nicht die Karte.
        dragging: !L.Browser.mobile,
      });
      mapRef.current = map;

      L.tileLayer(TILE_URL, {
        maxZoom: 19,
        attribution: TILE_ATTRIBUTION,
      }).addTo(map);

      const alle: LeafletNS.LatLngTuple[] = [[origin.lat, origin.lon]];

      const strecke = (
        from: Coordinates,
        to: Coordinates,
        geometry: string | undefined,
        rueckweg = false,
      ) => {
        const echt = geometry ? decodePolyline(geometry) : null;
        const punkte: LeafletNS.LatLngTuple[] =
          echt && echt.length >= 2 ? echt : [[from.lat, from.lon], [to.lat, to.lon]];
        alle.push(...punkte);

        // Heller Rand unter der Linie – hebt sie von Straßen gleicher Farbe ab.
        if (echt) {
          L.polyline(punkte, { color: '#ffffff', weight: 7, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);
        }
        L.polyline(punkte, {
          color: rueckweg ? '#8b807a' : ORANGE,
          weight: echt ? 4 : 3,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
          // Gestrichelt heißt: hier ist kein echter Weg bekannt.
          dashArray: echt ? (rueckweg ? '6 7' : undefined) : '2 8',
          interactive: false,
        }).addTo(map);
      };

      let from = origin;
      for (const step of steps) {
        if (step.travelFromPrevious.durationMin > 0 || step.travelFromPrevious.distanceMeters > 0) {
          strecke(from, step.place.location, step.travelFromPrevious.geometry);
        }
        from = step.place.location;
      }
      if (returnHome) strecke(from, home ?? origin, returnHome.geometry, true);

      // Startpunkt
      L.marker([origin.lat, origin.lon], {
        icon: L.divIcon({
          className: '',
          html: '<span class="block h-3 w-3 rounded-full border-2 border-white bg-ink shadow"></span>',
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
        keyboard: false,
      }).addTo(map);

      steps.forEach((step, index) => {
        L.marker([step.place.location.lat, step.place.location.lon], {
          icon: L.divIcon({
            className: '',
            html: `<span class="relative grid h-8 w-8 place-items-center rounded-full bg-white text-base shadow-lift ring-1 ring-black/10">${step.place.emoji}<span class="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-brand-500 text-[0.6rem] font-bold text-white">${index + 1}</span></span>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          }),
          title: step.place.name,
          keyboard: false,
        }).addTo(map);
      });

      map.fitBounds(L.latLngBounds(alle), { padding: [26, 26], maxZoom: 16.5 });
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [origin.lat, origin.lon, steps, returnHome, home]);

  return (
    // `isolate`: Leaflet stapelt seine Ebenen mit z-index 400 und höher. Ohne
    // eigenen Stapelkontext läge die Karte über Blättern und Dialogen.
    <div className="isolate overflow-hidden rounded-3xl bg-canvas-raised shadow-card hairline">
      <div
        ref={containerRef}
        className="h-52 w-full bg-canvas-sunk"
        role="img"
        aria-label={`Karte mit ${steps.length} Stationen`}
      />
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="min-w-0 text-[0.78rem] text-ink-muted">
          {wegText(origin, steps, mobility, returnHome)}
        </span>
        <a
          href={mapsUrl(origin, steps, mobility)}
          target="_blank"
          rel="noopener noreferrer"
          className="tap shrink-0 rounded-xl bg-canvas-sunk px-3 py-1.5 text-[0.78rem] font-semibold text-ink-soft"
        >
          Navigation starten
        </a>
      </div>
    </div>
  );
}

/**
 * Beschriftung unter der Karte – aus denselben Daten wie die Linie:
 *  - alles geroutet: „6,7 km Gesamtweg · ca. 1 Std. 25 Min. zu Fuß"
 *  - nichts geroutet: ausdrücklich „Luftlinie"
 *  - gemischt: Gesamtweg, aber als teils geschätzt gekennzeichnet
 */
function wegText(
  origin: Coordinates,
  steps: PlanStep[],
  mobility: Mobility,
  returnHome?: Plan['returnHome'],
): string {
  const summe = wegSumme({ steps, returnHome });
  if (summe.routing === 'all' && summe.meter > 0) {
    return `${formatDistance(summe.meter)} Gesamtweg · ca. ${formatDuration(summe.minuten)} ${UNTERWEGS[mobility]}`;
  }
  if (summe.routing === 'some') {
    return `ca. ${formatDistance(summe.meter)} Gesamtweg · teils geschätzt`;
  }
  const luftlinie = steps.reduce((sum, step, i) => {
    const previous = i === 0 ? origin : steps[i - 1].place.location;
    return sum + haversineMeters(previous, step.place.location);
  }, 0);
  return `${formatDistance(luftlinie)} Luftlinie insgesamt`;
}

const TRAVEL_MODE: Record<Mobility, string> = {
  walk: 'walking',
  bike: 'bicycling',
  transit: 'transit',
  car: 'driving',
};

function mapsUrl(origin: Coordinates, steps: PlanStep[], mobility: Mobility): string {
  const coord = (c: Coordinates) => `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
  const destination = steps[steps.length - 1]?.place.location ?? origin;
  const waypoints = steps
    .slice(0, -1)
    .map((s) => coord(s.place.location))
    .join('|');

  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', coord(origin));
  url.searchParams.set('destination', coord(destination));
  if (waypoints) url.searchParams.set('waypoints', waypoints);
  url.searchParams.set('travelmode', TRAVEL_MODE[mobility]);
  return url.toString();
}
