'use client';

import { useEffect, useRef } from 'react';
import type * as LeafletNS from 'leaflet';
import { formatDistance, haversineMeters } from '@/lib/geo';
import type { Coordinates, Mobility, PlanStep } from '@/types/domain';
import 'leaflet/dist/leaflet.css';

type Props = {
  origin: Coordinates;
  steps: PlanStep[];
  mobility: Mobility;
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

/**
 * Echte Karte der Stationen. Leaflet wird erst im Browser geladen (~42 kB),
 * damit die Plan-Seite sofort sichtbar ist und die Karte nachrückt.
 *
 * Die Linie zwischen den Stationen ist bewusst eine direkte Verbindung und
 * keine Straßenführung: Die Fahrzeiten kommen zwar aus echtem Routing, die
 * Geometrie holen wir (noch) nicht mit. Deshalb ist sie gestrichelt
 * dargestellt und die Navigation führt in die Karten-App des Geräts.
 */
export function PlanMap({ origin, steps, mobility }: Props) {
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
        // Auf dem Handy soll die Seite scrollen, nicht die Karte.
        dragging: !L.Browser.mobile,
      });
      mapRef.current = map;

      L.tileLayer(TILE_URL, {
        maxZoom: 19,
        attribution: TILE_ATTRIBUTION,
      }).addTo(map);

      const points: LeafletNS.LatLngExpression[] = [
        [origin.lat, origin.lon],
        ...steps.map((s) => [s.place.location.lat, s.place.location.lon] as [number, number]),
      ];

      L.polyline(points, {
        color: '#f15c1c',
        weight: 3,
        opacity: 0.85,
        dashArray: '2 8',
        lineCap: 'round',
      }).addTo(map);

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

      map.fitBounds(L.latLngBounds(points as LeafletNS.LatLngTuple[]), {
        padding: [34, 34],
        maxZoom: 16,
      });
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [origin.lat, origin.lon, steps]);

  const totalMeters = [origin, ...steps.map((s) => s.place.location)]
    .slice(1)
    .reduce((sum, point, i) => {
      const previous = i === 0 ? origin : steps[i - 1].place.location;
      return sum + haversineMeters(previous, point);
    }, 0);

  return (
    <div className="overflow-hidden rounded-3xl bg-canvas-raised shadow-card hairline">
      <div
        ref={containerRef}
        className="h-52 w-full bg-canvas-sunk"
        role="img"
        aria-label={`Karte mit ${steps.length} Stationen`}
      />
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="text-[0.78rem] text-ink-muted">
          {formatDistance(totalMeters)} Luftlinie insgesamt
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
