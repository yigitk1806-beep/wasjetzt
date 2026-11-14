import { Prisma, PrismaClient } from '@prisma/client';
import {
  dedupe,
  toPlace,
  toSight,
  type OverpassElement,
} from '@/providers/osm/osmToPlace';
import type { OsmTags } from '@/providers/osm/taxonomy';
import type { PlaceProvider, PlaceQuery } from '@/providers/types';
import type { Coordinates, Place } from '@/types/domain';

const globalForPrisma = globalThis as unknown as { __wasjetztPrisma?: PrismaClient };

function client(): PrismaClient {
  if (!globalForPrisma.__wasjetztPrisma) {
    globalForPrisma.__wasjetztPrisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return globalForPrisma.__wasjetztPrisma;
}

/**
 * Für diese Gegend liegen keine eigenen Ortsdaten vor.
 *
 * Wichtig, dass das ein eigener Fehler ist und nicht einfach eine leere
 * Liste: „hier gibt es nichts" und „diese Stadt haben wir nicht importiert"
 * sind verschiedene Aussagen. Nur im zweiten Fall darf auf OpenStreetMap
 * ausgewichen werden.
 */
export class GebietNichtAbgedecktError extends Error {
  constructor(detail: string) {
    super(`Keine eigenen Ortsdaten für ${detail}`);
    this.name = 'GebietNichtAbgedecktError';
  }
}

/**
 * Ortsdaten aus der eigenen Datenbank.
 *
 * Gefüllt aus freien Geofabrik-Auszügen (siehe `infra/osm-import/`). Der
 * Grund dafür steht im Schema: Die öffentlichen Overpass-Server tragen die
 * Last nicht – am 04.11.2026 waren alle drei seit 15 Tagen im Zeitlimit.
 *
 * Diese Quelle ist kein Zwischenspeicher. Sie ist eine vollständige Kopie
 * der Orte eines Gebiets und antwortet aus der eigenen Datenbank, ohne
 * fremdes Netz. Dafür ist sie so alt wie der Auszug – deshalb trägt jeder
 * Importlauf seinen Stand, und `/api/health` zeigt ihn an.
 *
 * Die Umwandlung in einen `Place` macht `toPlace` beziehungsweise
 * `toSight` aus dem Overpass-Provider. Das ist Absicht: Gespeichert sind
 * die rohen OSM-Tags, und beide Quellen laufen durch dieselbe
 * Klassifizierung. Sie können deshalb nicht auseinanderlaufen – eine
 * Änderung an der Taxonomie wirkt sofort auf beide.
 */
export class PostgresPlaceProvider implements PlaceProvider {
  readonly id = 'postgres-osm';
  readonly isMock = false;

  async search(query: PlaceQuery): Promise<Place[]> {
    const { center, radiusMeters } = query;
    const kasten = umkreisKasten(center, radiusMeters);

    // Sehenswürdigkeiten und Ausgehorte sind zwei Bestände mit
    // Überschneidung: Eine Kirche ist nur das eine, ein Museum beides.
    // Die Abfrage holt nur, was zum Thema passt.
    const thema = query.theme === 'sights' ? Prisma.sql`"sight" IS NOT NULL` : Prisma.sql`"profil" IS NOT NULL`;
    // Der Längengrad wird zum Pol hin schmaler – ohne diesen Faktor wären
    // Orte im Osten und Westen in der Sortierung zu weit entfernt.
    const breite = Math.cos((center.lat * Math.PI) / 180);

    // Nach Abstand sortiert und erst dann begrenzt. Ohne Sortierung lieferte
    // Postgres bei großem Umkreis IRGENDWELCHE 4000 von Berlins 18.000 Orten:
    // Das Café nebenan konnte fehlen, ein Ort neun Kilometer weiter war dabei.
    const reihen = await client().$queryRaw<Reihe[]>`
      SELECT "id", "lat", "lon", "tags"
      FROM "OsmPlace"
      WHERE "lat" BETWEEN ${kasten.latMin} AND ${kasten.latMax}
        AND "lon" BETWEEN ${kasten.lonMin} AND ${kasten.lonMax}
        -- Die Glücksspielsperre greift hier zum ersten Mal, nicht zum
        -- einzigen Mal: passesHardFilters und tourBuilder prüfen weiter.
        AND "gambling" = false
        AND ${thema}
      ORDER BY power("lat" - ${center.lat}, 2) + power(("lon" - ${center.lon}) * ${breite}, 2)
      -- Großzügig: Die Engine filtert danach noch nach Kategorie, Öffnung
      -- und Entfernung. Zu früh zu knapp zu greifen nimmt ihr die Auswahl.
      LIMIT 4000
    `;

    if (reihen.length === 0) {
      // Nichts im Umkreis – liegt das an der Gegend oder am Datenstand?
      // Wenn im weiten Umfeld überhaupt nichts liegt, ist das Gebiet nicht
      // importiert, und Overpass ist die richtige Quelle.
      if (!(await gebietAbgedeckt(center))) {
        throw new GebietNichtAbgedecktError(`${center.lat.toFixed(3)},${center.lon.toFixed(3)}`);
      }
      return [];
    }

    const umwandeln = query.theme === 'sights' ? toSight : toPlace;
    const orte = reihen
      .map((reihe) => umwandeln(alsElement(reihe)))
      .filter((ort): ort is Place => ort !== null);

    const sortiert = orte
      .map((ort) => ({ ort, abstand: meter(center, ort.location) }))
      .filter((x) => x.abstand <= radiusMeters)
      .sort((a, b) => a.abstand - b.abstand)
      .map((x) => x.ort);

    const fertig = dedupe(sortiert);
    return query.limit ? fertig.slice(0, query.limit) : fertig;
  }

  async getById(id: string): Promise<Place | null> {
    // Die Kennung im Plan ist `osm_n123` – gespeichert ist `node/123`.
    const roh = ausPlaceId(id);
    if (!roh) return null;
    const reihe = await client().osmPlace.findUnique({
      where: { id: roh },
      select: { id: true, lat: true, lon: true, tags: true },
    });
    if (!reihe) return null;
    return toPlace(alsElement(reihe)) ?? toSight(alsElement(reihe));
  }
}

/** Der jüngste Importlauf je Gebiet – für `/api/health`. */
export async function ortsdatenStand(): Promise<
  Array<{ gebiet: string; datenStand: string; importiert: string; orte: number }>
> {
  const laeufe = await client().osmImport.findMany({
    orderBy: { datenStand: 'desc' },
    select: { gebiet: true, datenStand: true, importiert: true, orte: true },
  });
  return laeufe.map((l) => ({
    gebiet: l.gebiet,
    datenStand: l.datenStand.toISOString(),
    importiert: l.importiert.toISOString(),
    orte: l.orte,
  }));
}

/**
 * Liegt der Punkt INNERHALB eines importierten Gebiets?
 *
 * Geprüft wird, ob es in allen vier Himmelsrichtungen binnen 15 km
 * importierte Orte gibt. Ein Punkt mitten im Gebiet hat überall Nachbarn;
 * ein Punkt draußen vor der Grenze nur auf einer Seite.
 *
 * Die erste Fassung fragte nur „irgendetwas im Umkreis von 60 km". Damit
 * galt Magdeburg als abgedeckt, weil Brandenburg keine 60 km entfernt ist –
 * und Nutzer dort bekamen „nichts Passendes" statt der Orte von Overpass.
 *
 * Die Fehlerrichtungen sind bewusst ungleich: Ein falsches „nicht
 * abgedeckt" führt nur auf den alten Weg über Overpass und ist harmlos. Ein
 * falsches „abgedeckt" hieße einen leeren Plan.
 */
async function gebietAbgedeckt(center: Coordinates): Promise<boolean> {
  const k = umkreisKasten(center, 15_000);
  const [r] = await client().$queryRaw<
    Array<{ nord: boolean; sued: boolean; ost: boolean; west: boolean }>
  >`
    SELECT
      bool_or("lat" >= ${center.lat}) AS nord,
      bool_or("lat" <= ${center.lat}) AS sued,
      bool_or("lon" >= ${center.lon}) AS ost,
      bool_or("lon" <= ${center.lon}) AS west
    FROM "OsmPlace"
    WHERE "lat" BETWEEN ${k.latMin} AND ${k.latMax}
      AND "lon" BETWEEN ${k.lonMin} AND ${k.lonMax}
  `;
  return Boolean(r?.nord && r.sued && r.ost && r.west);
}

export type Reihe = { id: string; lat: number; lon: number; tags: unknown };

/**
 * Eine Datenbankzeile in die Form, die `toPlace` erwartet.
 *
 * Bewusst dieselbe Form wie eine Overpass-Antwort: So braucht die
 * Umwandlung keinen zweiten Pfad, den man vergessen könnte zu pflegen.
 */
export function alsElement(reihe: Reihe): OverpassElement {
  const [art, kennung] = reihe.id.split('/');
  return {
    type: art === 'way' ? 'way' : art === 'relation' ? 'relation' : 'node',
    id: Number(kennung),
    lat: reihe.lat,
    lon: reihe.lon,
    tags: (reihe.tags ?? {}) as OsmTags,
  };
}

/** `osm_n123` → `node/123`. Umkehrung der Kennung aus `toPlace`. */
export function ausPlaceId(id: string): string | null {
  const treffer = /^osm_([nwr])(\d+)$/.exec(id);
  if (!treffer) return null;
  const art = { n: 'node', w: 'way', r: 'relation' }[treffer[1]];
  return `${art}/${treffer[2]}`;
}

/**
 * Ein Rechteck um den Mittelpunkt. Grob, aber in der richtigen Richtung
 * grob: Der Längengrad wird zum Pol hin schmaler, deshalb der Kosinus.
 * Die genaue Entfernung prüft danach `meter` – das Rechteck ist nur dafür
 * da, die Datenbank nicht den ganzen Bestand lesen zu lassen.
 */
export function umkreisKasten(center: Coordinates, radiusMeters: number) {
  const latGrad = radiusMeters / 111_320;
  const lonGrad = radiusMeters / (111_320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  return {
    latMin: center.lat - latGrad,
    latMax: center.lat + latGrad,
    lonMin: center.lon - lonGrad,
    lonMax: center.lon + lonGrad,
  };
}

function meter(a: Coordinates, b: Coordinates): number {
  const R = 6_371_000;
  const bogen = Math.PI / 180;
  const dLat = (b.lat - a.lat) * bogen;
  const dLon = (b.lon - a.lon) * bogen;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * bogen) * Math.cos(b.lat * bogen) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
