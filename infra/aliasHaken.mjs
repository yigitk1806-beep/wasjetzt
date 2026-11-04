/**
 * Loest den `@/`-Alias auch fuer Node auf.
 *
 * Next.js kennt ihn aus der tsconfig, Node nicht. Die Importskripte und
 * Tests unter `infra/` laufen aber ohne Uebersetzungsschritt - sie laden die
 * Dateien der App direkt und entfernen nur die Typen.
 *
 * Die Alternative waere gewesen, im App-Code relative Pfade mit
 * `.ts`-Endung zu schreiben, damit Node sie findet. Das haette heissen,
 * dass sich eine Datei der Anwendung nach den Werkzeugen richtet, die sie
 * pruefen. Dieser Haken ist der kleinere Eingriff und bleibt dort, wo er
 * hingehoert: bei den Werkzeugen.
 *
 * Benutzung:
 *   node --import ./infra/aliasHaken.mjs --experimental-strip-types <skript>
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(new URL('./aliasAufloeser.mjs', import.meta.url), pathToFileURL('./'));
