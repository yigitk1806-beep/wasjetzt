'use client';

import { weatherEmoji } from '@/engine/weatherRules';
import type { WeatherSlice } from '@/types/domain';

type Props = {
  locationLabel: string | null;
  locating: boolean;
  weather: WeatherSlice | null;
  onLocationClick: () => void;
};

/** Kopfzeile: Name, Ort, Wetter. Mehr braucht die Startseite oben nicht. */
export function TopBar({ locationLabel, locating, weather, onLocationClick }: Props) {
  return (
    <header className="shell safe-top flex items-center justify-between gap-3 pt-3">
      <span className="text-[1.05rem] font-bold tracking-tight">
        Was<span className="text-brand-500">Jetzt</span>
      </span>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onLocationClick}
          className="tap flex items-center gap-1.5 rounded-full bg-canvas-raised/80 px-3 py-1.5 text-[0.82rem] font-medium text-ink-soft hairline backdrop-blur"
        >
          <span aria-hidden>📍</span>
          <span className="max-w-[9rem] truncate">
            {locating ? 'Standort …' : (locationLabel ?? 'Ort wählen')}
          </span>
        </button>

        {weather ? (
          <span className="flex items-center gap-1 rounded-full bg-canvas-raised/80 px-3 py-1.5 text-[0.82rem] font-medium text-ink-soft hairline backdrop-blur">
            <span aria-hidden>{weatherEmoji(weather)}</span>
            {Math.round(weather.temperatureC)} °C
          </span>
        ) : null}
      </div>
    </header>
  );
}
