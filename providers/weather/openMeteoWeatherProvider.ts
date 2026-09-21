import type { WeatherProvider } from '@/providers/types';
import type {
  Coordinates,
  WeatherCondition,
  WeatherForecast,
  WeatherSlice,
} from '@/types/domain';

/** WMO-Wettercodes → grobe Kategorien. */
function conditionFromCode(code: number): WeatherCondition {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95) return 'thunderstorm';
  return 'unknown';
}

type OpenMeteoResponse = {
  /** Mit `timezone=auto`: Versatz der Ortszeit gegenüber UTC. */
  utc_offset_seconds?: number;
  hourly?: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: number[];
    precipitation: number[];
    weather_code: number[];
    wind_speed_10m: number[];
    is_day: number[];
  };
  daily?: {
    sunrise: string[];
    sunset: string[];
  };
};

/**
 * Echte Wetterdaten von Open-Meteo (kein API-Key nötig).
 * Fällt bei Netzfehlern auf eine neutrale Annahme zurück,
 * damit die Planung nie blockiert.
 */
export class OpenMeteoWeatherProvider implements WeatherProvider {
  readonly id = 'open-meteo';

  private cache = new Map<string, { at: number; data: WeatherForecast }>();
  private readonly ttlMs = 15 * 60 * 1000;

  async forecast(at: Coordinates, hours = 24): Promise<WeatherForecast> {
    const key = `${at.lat.toFixed(2)},${at.lon.toFixed(2)}`;
    const cached = this.cache.get(key);
    // Zwischengespeichert wird immer die volle Vorhersage; gekürzt wird erst
    // hier. Sonst bekäme ein Tagesplan nur so viele Stunden, wie der erste
    // Aufrufer (etwa die Startseite mit 12) zufällig angefragt hat.
    if (cached && Date.now() - cached.at < this.ttlMs) return kuerzen(cached.data, hours);

    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', at.lat.toFixed(4));
      url.searchParams.set('longitude', at.lon.toFixed(4));
      url.searchParams.set(
        'hourly',
        'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,is_day',
      );
      url.searchParams.set('daily', 'sunrise,sunset');
      url.searchParams.set('forecast_days', '2');
      url.searchParams.set('timezone', 'auto');

      const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (!res.ok) throw new Error(`open-meteo ${res.status}`);
      const json = (await res.json()) as OpenMeteoResponse;
      const parsed = this.parse(json);
      this.cache.set(key, { at: Date.now(), data: parsed });
      return kuerzen(parsed, hours);
    } catch {
      return this.fallback();
    }
  }

  private parse(json: OpenMeteoResponse): WeatherForecast {
    const h = json.hourly;
    if (!h || !h.time?.length) return this.fallback();

    // Open-Meteo liefert mit `timezone=auto` die Ortszeit ohne Zonenangabe,
    // etwa "2026-09-21T06:00". `new Date()` würde das als Zeit des *Servers*
    // lesen – bei Vercel UTC, also zwei Stunden daneben. Deshalb als UTC lesen
    // und den mitgelieferten Versatz abziehen.
    const offset = json.utc_offset_seconds ?? 0;
    const ortszeit = (text: string) => new Date(Date.parse(`${text}Z`) - offset * 1000);

    const now = Date.now();
    const slices: WeatherSlice[] = h.time.map((time, i) => ({
      time: ortszeit(time).toISOString(),
      temperatureC: h.temperature_2m[i],
      condition: conditionFromCode(h.weather_code[i]),
      precipitationProbability: h.precipitation_probability?.[i] ?? 0,
      precipitationMm: h.precipitation?.[i] ?? 0,
      windKmh: h.wind_speed_10m?.[i] ?? 0,
      isDay: (h.is_day?.[i] ?? 1) === 1,
    }));

    const upcoming = slices.filter((s) => new Date(s.time).getTime() >= now - 60 * 60 * 1000);
    const list = upcoming.length ? upcoming : slices;

    return {
      now: list[0],
      hourly: list,
      sunriseISO: json.daily?.sunrise?.[0] ? ortszeit(json.daily.sunrise[0]).toISOString() : undefined,
      sunsetISO: json.daily?.sunset?.[0] ? ortszeit(json.daily.sunset[0]).toISOString() : undefined,
      utcOffsetSeconds: json.utc_offset_seconds,
      source: 'open-meteo',
    };
  }

  /**
   * Neutraler Fallback: keine erfundenen Werte, sondern bewusst "unbekannt".
   * Die Engine behandelt `condition: 'unknown'` wetterneutral.
   */
  private fallback(): WeatherForecast {
    const slice: WeatherSlice = {
      time: new Date().toISOString(),
      temperatureC: 15,
      condition: 'unknown',
      precipitationProbability: 0,
      precipitationMm: 0,
      windKmh: 0,
      isDay: true,
    };
    return { now: slice, hourly: [slice], source: 'fallback' };
  }
}

function kuerzen(forecast: WeatherForecast, hours: number): WeatherForecast {
  return { ...forecast, hourly: forecast.hourly.slice(0, Math.max(1, hours)) };
}
