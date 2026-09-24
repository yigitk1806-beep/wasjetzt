'use client';

import { useEffect, useRef, useState } from 'react';
import type * as LeafletNS from 'leaflet';
import { Button } from '@/components/ui/Button';
import { useLocale } from '@/components/LocaleProvider';
import type { Coordinates } from '@/types/domain';
import 'leaflet/dist/leaflet.css';

const TILE_URL =
  process.env.NEXT_PUBLIC_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_TILE_ATTRIBUTION ?? '&copy; OpenStreetMap';

type Props = {
  center: Coordinates;
  onConfirm: (at: Coordinates, label: string | null) => void;
};

/**
 * Startpunkt auf der Karte wählen: Die Karte bewegt sich, das Fadenkreuz in
 * der Mitte bleibt – so wie man es von Navigations-Apps kennt. Beim Bestätigen
 * wird zum Punkt die echte Adresse gesucht; findet sich keine, heißt der
 * Startpunkt ehrlich „Auf der Karte gewählt" statt einer erfundenen Adresse.
 */
export function MapPicker({ center, onConfirm }: Props) {
  const { t, locale } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const mitte = useRef<Coordinates>(center);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    void (async () => {
      const L = await import('leaflet');
      if (cancelled || !containerRef.current) return;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const map = L.map(container, {
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: true,
        zoomSnap: 0.25,
      }).setView([center.lat, center.lon], 15);
      mapRef.current = map;

      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);

      const merken = () => {
        const c = map.getCenter();
        mitte.current = { lat: c.lat, lon: c.lng };
      };
      map.on('move', merken);
      // Antippen zentriert – schneller als schieben.
      map.on('click', (e: LeafletNS.LeafletMouseEvent) => map.panTo(e.latlng));
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [center.lat, center.lon]);

  async function bestaetigen() {
    setBusy(true);
    const at = mitte.current;
    let label: string | null = null;
    try {
      const res = await fetch(
        `/api/geocode?reverse=1&lat=${at.lat}&lon=${at.lon}&locale=${locale}`,
      );
      const data = (await res.json()) as { result?: { label: string; detail?: string } | null };
      if (data.result?.label) {
        label = [data.result.label, data.result.detail].filter(Boolean).join(', ');
      }
    } catch {
      // Ohne Namen ist der Punkt trotzdem gültig – die Koordinaten stimmen.
    }
    setBusy(false);
    onConfirm(at, label);
  }

  return (
    <div className="space-y-3">
      <div className="relative isolate overflow-hidden rounded-3xl hairline">
        <div ref={containerRef} className="h-64 w-full bg-canvas-sunk" />
        {/* Fadenkreuz – liegt über der Karte und fängt keine Klicks ab. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full text-[1.9rem] drop-shadow"
        >
          📍
        </span>
      </div>
      <p className="px-1 text-[0.8rem] text-ink-muted">{t.start.mapHint}</p>
      <Button full loading={busy} onClick={() => void bestaetigen()}>
        {t.start.mapConfirm}
      </Button>
    </div>
  );
}
