'use client';

import { useEffect, useState } from 'react';
import type { Coordinates, WeatherSlice } from '@/types/domain';

export type WeatherState = {
  now: WeatherSlice | null;
  sunsetISO?: string;
  loading: boolean;
  /** true, wenn die echte Quelle nicht erreichbar war. */
  degraded: boolean;
};

/** Lädt das aktuelle Wetter. Ein Fehlschlag ist kein Fehler für den Nutzer. */
export function useWeather(coords: Coordinates | null): WeatherState {
  const [state, setState] = useState<WeatherState>({
    now: null,
    loading: false,
    degraded: false,
  });

  useEffect(() => {
    if (!coords) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    fetch(`/api/weather?lat=${coords.lat.toFixed(4)}&lon=${coords.lon.toFixed(4)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('weather'))))
      .then((data) => {
        if (cancelled) return;
        setState({
          now: data.now ?? null,
          sunsetISO: data.sunsetISO,
          loading: false,
          degraded: data.source === 'fallback',
        });
      })
      .catch(() => {
        if (!cancelled) setState({ now: null, loading: false, degraded: true });
      });

    return () => {
      cancelled = true;
    };
  }, [coords?.lat, coords?.lon]);

  return state;
}
