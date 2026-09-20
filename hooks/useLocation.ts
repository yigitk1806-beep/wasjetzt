'use client';

import { useCallback, useEffect, useState } from 'react';
import { clearLocation, loadLocation, saveLocation, type StoredLocation } from '@/lib/clientStore';
import type { Coordinates } from '@/types/domain';

export type LocationStatus = 'idle' | 'locating' | 'ready' | 'unavailable';

/**
 * Standort ist die einzige Voraussetzung der App – deshalb wird er
 * automatisch angefragt, aber ein Fehlschlag blockiert nichts:
 * der Nutzer kann jederzeit manuell einen Ort wählen.
 */
export function useLocation() {
  const [location, setLocation] = useState<StoredLocation | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');

  useEffect(() => {
    const stored = loadLocation();
    if (stored) {
      setLocation(stored);
      setStatus('ready');
      // Gerätestandort im Hintergrund auffrischen, wenn er alt ist.
      const age = Date.now() - new Date(stored.savedAtISO).getTime();
      if (stored.fromDevice && age > 30 * 60 * 1000) void requestDevice(false);
      return;
    }
    void requestDevice(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestDevice = useCallback(async (showLoading: boolean) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus((prev) => (prev === 'ready' ? prev : 'unavailable'));
      return;
    }
    if (showLoading) setStatus('locating');

    return new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const next: StoredLocation = {
            label: 'Dein Standort',
            location: {
              lat: position.coords.latitude,
              lon: position.coords.longitude,
            },
            fromDevice: true,
            savedAtISO: new Date().toISOString(),
          };
          saveLocation(next);
          setLocation(next);
          setStatus('ready');
          resolve();
        },
        () => {
          setStatus((prev) => (prev === 'ready' ? prev : 'unavailable'));
          resolve();
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 },
      );
    });
  }, []);

  const setManual = useCallback((label: string, coords: Coordinates) => {
    const next: StoredLocation = {
      label,
      location: coords,
      fromDevice: false,
      savedAtISO: new Date().toISOString(),
    };
    saveLocation(next);
    setLocation(next);
    setStatus('ready');
  }, []);

  const forget = useCallback(() => {
    clearLocation();
    setLocation(null);
    setStatus('idle');
  }, []);

  return {
    location,
    status,
    requestDevice: () => requestDevice(true),
    setManual,
    forget,
  };
}
