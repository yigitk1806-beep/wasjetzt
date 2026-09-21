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

export function getProviders(): ProviderSet {
  if (!globalForProviders.__wasjetztProviders) {
    globalForProviders.__wasjetztProviders = {
      // Echte Orte aus OpenStreetMap; die Demo-Quelle springt nur ein,
      // wenn Overpass technisch nicht erreichbar ist.
      places: new FallbackPlaceProvider(
        new OverpassPlaceProvider(placeCache()),
        new MockPlaceProvider(),
      ),
      events: new MockEventProvider(),
      weather: new OpenMeteoWeatherProvider(),
      // Echtes Routing für Fuß/Rad/Auto; ÖPNV und Ausfälle fallen auf die
      // geometrische Schätzung zurück.
      routing: new FallbackRoutingProvider(
        new OsrmRoutingProvider(),
        new EstimateRoutingProvider(),
      ),
      geocoding: new OpenMeteoGeocodingProvider(),
      language: new RuleBasedLanguageProvider(),
    };
  }
  return globalForProviders.__wasjetztProviders;
}
