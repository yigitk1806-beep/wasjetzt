import { estimateTravelMinutes, haversineMeters } from '@/lib/geo';
import { formatClock } from '@/lib/time';
import type { Coordinates, Plan, PlanNote, PlanStep } from '@/types/domain';
import { passesHardFilters } from './hardFilters';
import { assemblePlan, homeLeg, replaceStep, roundToFive, weatherAt } from './planBuilder';
import { replaceTourStop, tourStopFits } from './tourBuilder';
import { note } from './texts';
import type { PlanContext } from './types';

/**
 * Einen fertigen Plan auf eine andere Startzeit legen.
 *
 * Nicht neu würfeln: Jede Station wird zuerst nur zeitlich verschoben. Erst
 * wenn sie zur neuen Uhrzeit geschlossen hat, nicht zur Tageszeit passt, das
 * Wetter dagegen spricht oder die Heimkehrzeit reißt, wird genau diese eine
 * Station ersetzt. Gibt es keinen passenden Ersatz, fällt sie weg – lieber
 * ein kürzerer Plan als einer, der zu spät endet.
 */
export type RetimeResult = { plan: Plan; ersetzt: number; weggelassen: number };

export function retimePlan(ctx: PlanContext, plan: Plan): RetimeResult | null {
  const isTour = plan.mode === 'tour';
  const steps: PlanStep[] = [];
  let cursor = new Date(ctx.start);
  let from: Coordinates = ctx.request.origin;
  let ersetzt = 0;
  let weggelassen = 0;

  for (let i = 0; i < plan.steps.length; i += 1) {
    const alt = plan.steps[i];
    // Gleicher Vorgänger wie bisher → der (evtl. echt geroutete) Weg bleibt.
    const vorher = i === 0 ? null : plan.steps[i - 1].place.id;
    const jetzt = steps.length === 0 ? null : steps[steps.length - 1].place.id;
    const verschoben = verschieben(ctx, alt, from, cursor, vorher === jetzt);

    let step: PlanStep | null = passt(ctx, verschoben, isTour) ? verschoben : null;

    if (!step) {
      const probe = assemblePlan(ctx, [...steps, verschoben, ...plan.steps.slice(i + 1)], plan.variant, 0, {
        id: plan.id,
      });
      const neu = isTour
        ? replaceTourStop(ctx, probe, verschoben.id, 'any')
        : replaceStep(ctx, probe, verschoben.id, 'any');
      const kandidat = neu?.steps[steps.length];
      if (kandidat && kandidat.place.id !== alt.place.id && passt(ctx, kandidat, isTour)) {
        step = kandidat;
        ersetzt += 1;
      }
    }

    if (!step) {
      weggelassen += 1;
      continue;
    }
    steps.push(step);
    cursor = new Date(step.endISO);
    from = step.place.location;
  }

  const stationen = isTour ? steps.filter((s) => s.place.themes?.length).length : steps.length;
  if (stationen === 0) return null;

  const neuerPlan = assemblePlan(ctx, steps, plan.variant, 0, {
    id: plan.id,
    shareCode: plan.shareCode,
    participants: plan.participants,
    meetingPoint: plan.meetingPoint,
    createdAtISO: plan.createdAtISO,
    // Die Geschwister-Varianten liegen noch auf der alten Zeit.
    siblings: undefined,
  });

  neuerPlan.notes.unshift(hinweis(ctx, ersetzt, weggelassen));
  return { plan: neuerPlan, ersetzt, weggelassen };
}

function verschieben(
  ctx: PlanContext,
  step: PlanStep,
  from: Coordinates,
  cursor: Date,
  gleicherWeg: boolean,
): PlanStep {
  let travel = step.travelFromPrevious;
  if (!gleicherWeg) {
    const distanceMeters = haversineMeters(from, step.place.location);
    travel = {
      mode: ctx.request.mobility,
      distanceMeters: Math.round(distanceMeters),
      durationMin: distanceMeters < 40 ? 0 : estimateTravelMinutes(distanceMeters, ctx.request.mobility),
      estimated: true,
    };
  }
  const start = roundToFive(new Date(cursor.getTime() + travel.durationMin * 60_000));
  return {
    ...step,
    startISO: start.toISOString(),
    endISO: new Date(start.getTime() + step.durationMin * 60_000).toISOString(),
    travelFromPrevious: travel,
  };
}

/** Dieselben Regeln wie beim Planen – nur für einen bereits gewählten Ort. */
function passt(ctx: PlanContext, step: PlanStep, isTour: boolean): boolean {
  const start = new Date(step.startISO);
  if (isTour) return tourStopFits(ctx, step.place, start, step.durationMin);

  const heim = homeLeg(ctx, step.place.location);
  return passesHardFilters({
    place: step.place,
    ctx,
    start,
    durationMin: step.durationMin,
    // Der Ort ist schon gewählt – der Umkreis spielt keine Rolle mehr.
    distanceMeters: 0,
    spentMin: 0,
    weatherAtStart: weatherAt(ctx.weather, step.startISO),
    reserveMinutes: heim?.durationMin ?? 0,
  }).ok;
}

function hinweis(ctx: PlanContext, ersetzt: number, weggelassen: number): PlanNote {
  return note(ctx, 'time', 'retimed', {
    time: formatClock(ctx.start.toISOString(), 'de', ctx.tzOffsetMin),
    replaced: ersetzt,
    dropped: weggelassen,
  });
}
