import { dictionaryFor, type Dictionary } from '@/lib/i18n';
import type { PlanNote } from '@/types/domain';
import type { PlanContext } from './types';

/**
 * Texte der Engine. Jeder Hinweis und jede Begründung trägt einen Schlüssel
 * ins Wörterbuch – die Oberfläche übersetzt damit in die Sprache dessen, der
 * den Plan gerade ansieht (auch bei geteilten Links). Der mitgelieferte Text
 * in der Sprache der Anfrage ist nur der Rückfall.
 */

export type ReasonKey = keyof Dictionary['reasons'];
export type NoteKey = keyof Dictionary['notes'];

export function dict(ctx: PlanContext): Dictionary {
  return dictionaryFor(ctx.request.language);
}

export function note(
  ctx: PlanContext,
  kind: PlanNote['kind'],
  key: NoteKey,
  params: Record<string, string | number> = {},
): PlanNote {
  const fn = dict(ctx).notes[key] as (p: Record<string, string | number>) => string;
  return { kind, key, params, text: fn(params) };
}

export function reasonText(ctx: PlanContext, key: ReasonKey): string {
  return dict(ctx).reasons[key];
}

/** Begründung für einen Schritt: Schlüssel plus Text als Rückfall. */
export function begruendung(ctx: PlanContext, key: ReasonKey): { reason: string; reasonKey: ReasonKey } {
  return { reason: reasonText(ctx, key), reasonKey: key };
}
