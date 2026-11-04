/**
 * Liest eine OpenStreetMap-PBF-Datei und gibt die Orte heraus, die Tags
 * tragen. Bewusst ohne fremde Abhaengigkeit: Das Format ist Protobuf mit
 * zlib, und beides bringt Node mit.
 *
 * Warum ueberhaupt selbst lesen? Die oeffentlichen Overpass-Server tragen
 * die Last nicht (gemessen am 04.11.2026: alle drei im Zeitlimit). Ein
 * Geofabrik-Auszug kostet nichts, ist taeglich neu und laeuft hier lokal.
 *
 * Was hier NICHT passiert: klassifizieren, filtern, bewerten. Dieser Leser
 * gibt die rohen Tags heraus - die Zuordnung macht `taxonomy.ts`, dieselbe
 * Datei, die auch die Overpass-Antworten verarbeitet. Nur so koennen die
 * beiden Quellen nicht auseinanderlaufen.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export type RohOrt = {
  /** `node/123` oder `way/456` - dieselbe Form, die auch Overpass liefert. */
  id: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
};

/* ------------------------------------------------------------------ *
 * Protobuf: nur das, was im PBF-Format wirklich vorkommt.
 * ------------------------------------------------------------------ */

/** Lesezeiger in einem Puffer. Ein Objekt, damit die Position mitwandert. */
type Zeiger = { buf: Buffer; pos: number; ende: number };

function varint(z: Zeiger): number {
  let ergebnis = 0;
  let schub = 1;
  for (;;) {
    const byte = z.buf[z.pos++];
    ergebnis += (byte & 0x7f) * schub;
    if ((byte & 0x80) === 0) return ergebnis;
    // Multiplikation statt Bitschieben: Ab 32 Bit faellt `<<` auf 32 Bit
    // zurueck und liefert Unsinn. OSM-Kennungen liegen bei zwoelf
    // Milliarden, also deutlich darueber.
    schub *= 128;
  }
}

/** Zickzack: Protobuf speichert negative Zahlen als gerade/ungerade. */
function zickzack(n: number): number {
  return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
}

function sintVarint(z: Zeiger): number {
  return zickzack(varint(z));
}

/** Ueberspringt ein Feld, dessen Inhalt hier nicht gebraucht wird. */
function ueberspringen(z: Zeiger, drahtart: number): void {
  if (drahtart === 0) varint(z);
  else if (drahtart === 1) z.pos += 8;
  else if (drahtart === 2) {
    // Erst lesen, dann springen - und zwar in zwei Schritten.
    // `z.pos += varint(z)` waere falsch: JavaScript merkt sich den alten
    // Wert von `z.pos`, bevor `varint` ihn selbst weiterschiebt, und
    // addiert die Laenge auf den veralteten Stand. Der Lesezeiger landet
    // dann um die Breite der Laengenangabe zu frueh, und ab da ist der
    // ganze Strom verschoben.
    const laenge = varint(z);
    z.pos += laenge;
  }
  else if (drahtart === 5) z.pos += 4;
  else throw new Error(`unbekannte Drahtart ${drahtart} bei Position ${z.pos}`);
}

/**
 * Laeuft die Felder einer Nachricht durch und ruft `behandeln` je Feld auf.
 * Gibt `behandeln` false zurueck, wird das Feld uebersprungen.
 */
function felder(z: Zeiger, behandeln: (nummer: number, drahtart: number) => boolean): void {
  while (z.pos < z.ende) {
    const kopf = varint(z);
    const nummer = Math.floor(kopf / 8);
    const drahtart = kopf % 8;
    if (!behandeln(nummer, drahtart)) ueberspringen(z, drahtart);
  }
}

/** Ein laengenbegrenztes Unterfeld als eigener Zeiger. */
function unterfeld(z: Zeiger): Zeiger {
  const laenge = varint(z);
  const unter: Zeiger = { buf: z.buf, pos: z.pos, ende: z.pos + laenge };
  z.pos += laenge;
  return unter;
}

function gepackt(z: Zeiger, lesen: (u: Zeiger) => number): number[] {
  const u = unterfeld(z);
  const werte: number[] = [];
  while (u.pos < u.ende) werte.push(lesen(u));
  return werte;
}

/* ------------------------------------------------------------------ *
 * PBF: Blobs, Bloecke, Gruppen.
 * ------------------------------------------------------------------ */

type Block = {
  /** Zeichenkettentabelle des Blocks - Tags verweisen nur auf Indizes. */
  texte: string[];
  granularitaet: number;
  latVersatz: number;
  lonVersatz: number;
  gruppen: Zeiger[];
};

/** Laeuft alle Datenbloecke der Datei durch. */
function* bloecke(datei: Buffer): Generator<Block> {
  let pos = 0;
  while (pos < datei.length) {
    // Jeder Blob beginnt mit der Laenge seines Kopfes, vier Bytes, big-endian.
    if (pos + 4 > datei.length) break;
    const kopflaenge = datei.readUInt32BE(pos);
    pos += 4;

    const kopf: Zeiger = { buf: datei, pos, ende: pos + kopflaenge };
    let art = '';
    let datenlaenge = 0;
    felder(kopf, (nummer, drahtart) => {
      if (nummer === 1 && drahtart === 2) {
        const u = unterfeld(kopf);
        art = datei.toString('utf8', u.pos, u.ende);
        return true;
      }
      if (nummer === 3 && drahtart === 0) {
        datenlaenge = varint(kopf);
        return true;
      }
      return false;
    });
    pos += kopflaenge;

    const blob: Zeiger = { buf: datei, pos, ende: pos + datenlaenge };
    let inhalt: Buffer | null = null;
    felder(blob, (nummer, drahtart) => {
      if (nummer === 1 && drahtart === 2) {
        // raw: unkomprimiert.
        const u = unterfeld(blob);
        inhalt = datei.subarray(u.pos, u.ende);
        return true;
      }
      if (nummer === 3 && drahtart === 2) {
        // zlib_data: der Normalfall.
        const u = unterfeld(blob);
        inhalt = inflateSync(datei.subarray(u.pos, u.ende));
        return true;
      }
      return false;
    });
    pos += datenlaenge;

    if (art !== 'OSMData' || inhalt === null) continue;
    yield blockLesen(inhalt);
  }
}

function blockLesen(roh: Buffer): Block {
  const z: Zeiger = { buf: roh, pos: 0, ende: roh.length };
  const texte: string[] = [];
  const gruppen: Zeiger[] = [];
  // Die Vorgaben stehen in der Formatbeschreibung, nicht in der Datei:
  // fehlt das Feld, gelten 100 Nanograd und kein Versatz.
  let granularitaet = 100;
  let latVersatz = 0;
  let lonVersatz = 0;

  felder(z, (nummer, drahtart) => {
    if (nummer === 1 && drahtart === 2) {
      const tabelle = unterfeld(z);
      felder(tabelle, (n, d) => {
        if (n === 1 && d === 2) {
          const u = unterfeld(tabelle);
          texte.push(roh.toString('utf8', u.pos, u.ende));
          return true;
        }
        return false;
      });
      return true;
    }
    if (nummer === 2 && drahtart === 2) {
      gruppen.push(unterfeld(z));
      return true;
    }
    if (nummer === 17 && drahtart === 0) {
      granularitaet = varint(z);
      return true;
    }
    if (nummer === 19 && drahtart === 0) {
      latVersatz = sintVarint(z);
      return true;
    }
    if (nummer === 20 && drahtart === 0) {
      lonVersatz = sintVarint(z);
      return true;
    }
    return false;
  });

  return { texte, granularitaet, latVersatz, lonVersatz, gruppen };
}

/** Rohkoordinate in Grad. Die Formel steht so in der Formatbeschreibung. */
function grad(wert: number, versatz: number, granularitaet: number): number {
  return 1e-9 * (versatz + granularitaet * wert);
}

/* ------------------------------------------------------------------ *
 * Knoten und Wege.
 * ------------------------------------------------------------------ */

/**
 * Alle Knoten mit Tags. `aufruf` bekommt jeden einzeln - so bleibt der
 * Speicher flach, auch wenn der Auszug Millionen Knoten enthaelt.
 */
export function leseKnoten(pfad: string, aufruf: (ort: RohOrt) => void): { knoten: number; mitTags: number } {
  const datei = readFileSync(pfad);
  let knoten = 0;
  let mitTags = 0;

  for (const block of bloecke(datei)) {
    for (const gruppe of block.gruppen) {
      const z: Zeiger = { buf: gruppe.buf, pos: gruppe.pos, ende: gruppe.ende };
      felder(z, (nummer, drahtart) => {
        // 1 = einzelne Knoten (selten), 2 = DenseNodes (der Normalfall).
        if (nummer === 1 && drahtart === 2) {
          const n = unterfeld(z);
          const ort = knotenLesen(n, block);
          knoten += 1;
          if (ort) {
            mitTags += 1;
            aufruf(ort);
          }
          return true;
        }
        if (nummer === 2 && drahtart === 2) {
          const d = unterfeld(z);
          const zahl = dichteKnotenLesen(d, block, aufruf);
          knoten += zahl.gesamt;
          mitTags += zahl.mitTags;
          return true;
        }
        return false;
      });
    }
  }

  return { knoten, mitTags };
}

function knotenLesen(z: Zeiger, block: Block): RohOrt | null {
  let id = 0;
  let lat = 0;
  let lon = 0;
  const schluessel: number[] = [];
  const werte: number[] = [];

  felder(z, (nummer, drahtart) => {
    if (nummer === 1 && drahtart === 0) { id = sintVarint(z); return true; }
    if (nummer === 2 && drahtart === 2) { schluessel.push(...gepackt(z, varint)); return true; }
    if (nummer === 3 && drahtart === 2) { werte.push(...gepackt(z, varint)); return true; }
    if (nummer === 8 && drahtart === 0) { lat = sintVarint(z); return true; }
    if (nummer === 9 && drahtart === 0) { lon = sintVarint(z); return true; }
    return false;
  });

  if (schluessel.length === 0) return null;
  const tags: Record<string, string> = {};
  for (let i = 0; i < schluessel.length; i += 1) {
    tags[block.texte[schluessel[i]]] = block.texte[werte[i]];
  }
  return {
    id: `node/${id}`,
    lat: grad(lat, block.latVersatz, block.granularitaet),
    lon: grad(lon, block.lonVersatz, block.granularitaet),
    tags,
  };
}

/**
 * DenseNodes: Kennungen und Koordinaten stehen als Differenzen zum
 * Vorgaenger, die Tags in einem einzigen Strom aus Indizes, je Knoten mit
 * einer Null abgeschlossen. Knoten ohne Tags sind dort nur eine Null.
 */
function dichteKnotenLesen(
  z: Zeiger,
  block: Block,
  aufruf: (ort: RohOrt) => void,
): { gesamt: number; mitTags: number } {
  let ids: number[] = [];
  let lats: number[] = [];
  let lons: number[] = [];
  let schluesselWerte: number[] = [];

  felder(z, (nummer, drahtart) => {
    if (nummer === 1 && drahtart === 2) { ids = gepackt(z, sintVarint); return true; }
    if (nummer === 8 && drahtart === 2) { lats = gepackt(z, sintVarint); return true; }
    if (nummer === 9 && drahtart === 2) { lons = gepackt(z, sintVarint); return true; }
    if (nummer === 10 && drahtart === 2) { schluesselWerte = gepackt(z, varint); return true; }
    return false;
  });

  let id = 0;
  let lat = 0;
  let lon = 0;
  let kv = 0;
  let mitTags = 0;

  for (let i = 0; i < ids.length; i += 1) {
    id += ids[i];
    lat += lats[i];
    lon += lons[i];

    const tags: Record<string, string> = {};
    let hatTags = false;
    // Fehlt der Tag-Strom ganz, hat in diesem Block kein Knoten Tags.
    if (schluesselWerte.length > 0) {
      while (kv < schluesselWerte.length && schluesselWerte[kv] !== 0) {
        tags[block.texte[schluesselWerte[kv]]] = block.texte[schluesselWerte[kv + 1]];
        kv += 2;
        hatTags = true;
      }
      kv += 1; // die abschliessende Null
    }

    if (hatTags) {
      mitTags += 1;
      aufruf({
        id: `node/${id}`,
        lat: grad(lat, block.latVersatz, block.granularitaet),
        lon: grad(lon, block.lonVersatz, block.granularitaet),
        tags,
      });
    }
  }

  return { gesamt: ids.length, mitTags };
}

export type RohWeg = {
  id: number;
  tags: Record<string, string>;
  /** Die Knoten, aus denen der Weg besteht - fuer den Mittelpunkt. */
  knoten: number[];
};

/** Alle Wege mit Tags. Koordinaten fehlen noch - die stehen bei den Knoten. */
export function leseWege(pfad: string, aufruf: (weg: RohWeg) => void): { wege: number; mitTags: number } {
  const datei = readFileSync(pfad);
  let wege = 0;
  let mitTags = 0;

  for (const block of bloecke(datei)) {
    for (const gruppe of block.gruppen) {
      const z: Zeiger = { buf: gruppe.buf, pos: gruppe.pos, ende: gruppe.ende };
      felder(z, (nummer, drahtart) => {
        if (nummer === 3 && drahtart === 2) {
          const w = unterfeld(z);
          wege += 1;
          const weg = wegLesen(w, block);
          if (weg) {
            mitTags += 1;
            aufruf(weg);
          }
          return true;
        }
        return false;
      });
    }
  }

  return { wege, mitTags };
}

function wegLesen(z: Zeiger, block: Block): RohWeg | null {
  let id = 0;
  const schluessel: number[] = [];
  const werte: number[] = [];
  let versatzKnoten: number[] = [];

  felder(z, (nummer, drahtart) => {
    // Anders als beim Knoten ist die Weg-Kennung kein Zickzack-Wert.
    if (nummer === 1 && drahtart === 0) { id = varint(z); return true; }
    if (nummer === 2 && drahtart === 2) { schluessel.push(...gepackt(z, varint)); return true; }
    if (nummer === 3 && drahtart === 2) { werte.push(...gepackt(z, varint)); return true; }
    if (nummer === 8 && drahtart === 2) { versatzKnoten = gepackt(z, sintVarint); return true; }
    return false;
  });

  if (schluessel.length === 0) return null;
  const tags: Record<string, string> = {};
  for (let i = 0; i < schluessel.length; i += 1) {
    tags[block.texte[schluessel[i]]] = block.texte[werte[i]];
  }

  // Auch die Knotenverweise stehen als Differenzen.
  const knoten: number[] = [];
  let laufend = 0;
  for (const d of versatzKnoten) {
    laufend += d;
    knoten.push(laufend);
  }

  return { id, tags, knoten };
}

/** Koordinaten zu einer Menge gesuchter Knotenkennungen. */
export function leseKoordinaten(pfad: string, gesucht: Set<number>): Map<number, [number, number]> {
  const datei = readFileSync(pfad);
  const gefunden = new Map<number, [number, number]>();

  for (const block of bloecke(datei)) {
    for (const gruppe of block.gruppen) {
      const z: Zeiger = { buf: gruppe.buf, pos: gruppe.pos, ende: gruppe.ende };
      felder(z, (nummer, drahtart) => {
        if (nummer === 2 && drahtart === 2) {
          const d = unterfeld(z);
          let ids: number[] = [];
          let lats: number[] = [];
          let lons: number[] = [];
          felder(d, (n, art) => {
            if (n === 1 && art === 2) { ids = gepackt(d, sintVarint); return true; }
            if (n === 8 && art === 2) { lats = gepackt(d, sintVarint); return true; }
            if (n === 9 && art === 2) { lons = gepackt(d, sintVarint); return true; }
            return false;
          });
          let id = 0;
          let lat = 0;
          let lon = 0;
          for (let i = 0; i < ids.length; i += 1) {
            id += ids[i];
            lat += lats[i];
            lon += lons[i];
            if (gesucht.has(id)) {
              gefunden.set(id, [
                grad(lat, block.latVersatz, block.granularitaet),
                grad(lon, block.lonVersatz, block.granularitaet),
              ]);
            }
          }
          return true;
        }
        if (nummer === 1 && drahtart === 2) {
          const n = unterfeld(z);
          // Einzelne Knoten: selten, aber sie duerfen nicht fehlen.
          let id = 0;
          let lat = 0;
          let lon = 0;
          felder(n, (f, art) => {
            if (f === 1 && art === 0) { id = sintVarint(n); return true; }
            if (f === 8 && art === 0) { lat = sintVarint(n); return true; }
            if (f === 9 && art === 0) { lon = sintVarint(n); return true; }
            return false;
          });
          if (gesucht.has(id)) {
            gefunden.set(id, [
              grad(lat, block.latVersatz, block.granularitaet),
              grad(lon, block.lonVersatz, block.granularitaet),
            ]);
          }
          return true;
        }
        return false;
      });
    }
  }

  return gefunden;
}
