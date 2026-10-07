import { PrismaPlaceCache } from '@/db/prismaPlaceCache';
import { FallbackPlaceProvider } from './fallbackPlaceProvider';
import { InMemoryPlaceCache, LayeredPlaceCache, type PlaceCacheStore } from './placeCache';
import { MockEventProvider } from './mock/mockEventProvider';
import { MockPlaceProvider } from './mock/mockPlaceProvider';
import { OverpassPlaceProvider } from './osm/overpassPlaceProvider';
import { EstimateRoutingProvider } from './routing/estimateRoutingProvider';
import { FallbackRoutingProvider } from './routing/fallbackRoutingProvider';
import { OsrmRoutingProvider } from './routing/osrmRoutingProvider';
import { OpenMeteoWeatherProvider } from './weather/openMeteoWeatherProvider';
import { OpenMeteoGeocodingProvider } from './geocoding/openMeteoGeocodingProvider';
import { PhotonGeocodingProvider } from './geocoding/photonGeocodingProvider';
import { CompositeGeocodingProvider } from './geocoding/compositeGeocodingProvider';
import { RuleBasedLanguageProvider } from './language/ruleBasedLanguageProvider';
import type {
  EventProvider,
  GeocodingProvider,
  LanguageProvider,
  PlaceProvider,
  RoutingProvider,
  WeatherProvider,
} from './types';

/**
 * Einzige Stelle, an der konkrete Provider ausgewählt werden.
 * Der Austausch gegen echte APIs passiert hier – nicht in der Engine.
 *
 * Provider werden als Singletons gehalten, damit ihre Caches über
 * Requests hinweg wirken.
 */
export type ProviderSet = {
  places: PlaceProvider;
  events: EventProvider;
  weather: WeatherProvider;
  routing: RoutingProvider;
  geocoding: GeocodingProvider;
  language: LanguageProvider;
};

const globalForProviders = globalThis as unknown as {
  __wasjetztProviders?: ProviderSet;
};

/**
 * Mit Datenbank teilen sich alle Instanzen einen Ortscache. Ohne Datenbank
 * bleibt er im Arbeitsspeicher – lokal reicht das, serverlos nicht.
 */
function placeCache(): PlaceCacheStore {
  return process.env.DATABASE_URL
    ? new LayeredPlaceCache(new InMemoryPlaceCache(), new PrismaPlaceCache())
    : new InMemoryPlaceCache();
}

/**
 * Dürfen Demo-Orte einspringen, wenn Overpass ausfällt?
 *
 * In Produktion nicht. Ein Plan aus Demo-Daten sieht für den Nutzer aus wie
 * jeder andere Plan – gekennzeichnet oder nicht, er würde zu Orten laufen,
 * die es so nicht gibt. Eine ehrliche Fehlmeldung ist besser als ein
 * erfundener Abend. Lokal und in Tests bleibt die Quelle nützlich; dort ist
 * der Unterschied bekannt.
 *
 * `WASJETZT_DEMO_ORTE=0` schaltet sie auch lokal ab – so lassen sich die
 * Ausfallwege prüfen. `=1` erzwingt sie.
 */
export function demoOrteErlaubt(): boolean {
  const schalter = process.env.WASJETZT_DEMO_ORTE;
  if (schalter === '1') return true;
  if (schalter === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

/**
 * Waren die echten Ortsdaten nicht erreichbar?
 *
 * Das ist kein Planungsfehler, sondern ein Ausfall einer fremden Quelle –
 * Zeitüberschreitung, 429, 504, 5xx. Die Oberfläche soll dafür „gleich
 * nochmal versuchen" sagen und nicht „nichts Passendes gefunden".
 */
export function istDatenAusfall(error: unknown): boolean {
  return error instanceof Error && error.name === 'OverpassUnavailableError';
}

export function getProviders(): ProviderSet {
  if (!globalForProviders.__wasjetztProviders) {
    globalForProviders.__wasjetztProviders = {
      // Echte Orte aus OpenStreetMap. In Produktion gibt es dahinter nichts:
      // Fällt Overpass aus, bekommt der Nutzer eine Fehlmeldung, keinen Plan
      // aus Demo-Orten.
      places: demoOrteErlaubt()
        ? new FallbackPlaceProvider(
            new OverpassPlaceProvider(placeCache()),
            new MockPlaceProvider(),
          )
        : new OverpassPlaceProvider(placeCache()),
      events: new MockEventProvider(),
      weather: new OpenMeteoWeatherProvider(),
      // Echtes Routing für Fuß/Rad/Auto; ÖPNV und Ausfälle fallen auf die
      // geometrische Schätzung zurück.
      routing: new FallbackRoutingProvider(
        new OsrmRoutingProvider(),
        new EstimateRoutingProvider(),
      ),
      // Städte über Open-Meteo (gutes Ranking nach Einwohnerzahl),
      // Adressen über Photon (echte Hausnummern-Koordinaten).
      geocoding: new CompositeGeocodingProvider(
        new OpenMeteoGeocodingProvider(),
        new PhotonGeocodingProvider(),
      ),
      language: new RuleBasedLanguageProvider(),
    };
  }
  return globalForProviders.__wasjetztProviders;
}
