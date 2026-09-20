import { hashString, seededRandom } from '@/lib/id';
import { haversineMeters, offsetCoordinates } from '@/lib/geo';
import type { EventProvider, EventQuery } from '@/providers/types';
import type { Place } from '@/types/domain';
import { buildHours } from './templates';

const EVENT_KINDS = [
  { kind: 'Open-Air-Konzert', emoji: '🎤', outdoor: true, priceLevel: 2, durationMin: 150 },
  { kind: 'Late-Night-Führung', emoji: '🔦', outdoor: false, priceLevel: 1, durationMin: 90 },
  { kind: 'Quiz-Abend', emoji: '🧠', outdoor: false, priceLevel: 1, durationMin: 120 },
  { kind: 'Streetfood-Festival', emoji: '🥘', outdoor: true, priceLevel: 1, durationMin: 120 },
  { kind: 'Flohmarkt', emoji: '🪑', outdoor: true, priceLevel: 0, durationMin: 90 },
  { kind: 'Comedy-Bühne', emoji: '🎙️', outdoor: false, priceLevel: 2, durationMin: 105 },
] as const;

/**
 * Demo-Events. Wie beim MockPlaceProvider sind alle Angaben erfunden und
 * als `source: 'mock'` markiert. Ein echter Event-Provider (z. B. Ticket-API)
 * ersetzt diese Klasse, ohne dass die Engine sich ändert.
 */
export class MockEventProvider implements EventProvider {
  readonly id = 'mock-events';
  readonly isMock = true;

  async search(query: EventQuery): Promise<Place[]> {
    const from = new Date(query.fromISO);
    const dayKey = from.toISOString().slice(0, 10);
    const seed = hashString(
      `${query.center.lat.toFixed(2)}|${query.center.lon.toFixed(2)}|${dayKey}`,
    );
    const rnd = seededRandom(seed);
    const out: Place[] = [];
    const count = 1 + Math.floor(rnd() * 3);

    for (let i = 0; i < count; i += 1) {
      const spec = EVENT_KINDS[Math.floor(rnd() * EVENT_KINDS.length)];
      const angle = rnd() * Math.PI * 2;
      const radius = Math.min(query.radiusMeters, 1000 + rnd() * 6000);
      const location = offsetCoordinates(
        query.center,
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      );
      if (haversineMeters(query.center, location) > query.radiusMeters) continue;

      const startHour = 17 + Math.floor(rnd() * 4);
      out.push({
        id: `mockevent_${seed.toString(36)}_${i}`,
        name: `${spec.kind} (heute)`,
        category: 'event',
        kind: spec.kind,
        emoji: spec.emoji,
        location,
        price: { level: spec.priceLevel, levelEstimated: true },
        typicalDurationMin: spec.durationMin,
        openingHours: buildHours([
          { open: `${String(startHour).padStart(2, '0')}:00`, close: '24:00' },
        ]),
        indoorOutdoor: spec.outdoor ? 'outdoor' : 'indoor',
        rainSuitability: spec.outdoor ? 0.1 : 1,
        heatSuitability: spec.outdoor ? 0.8 : 0.95,
        coldSuitability: spec.outdoor ? 0.2 : 1,
        bestSeasons: [],
        scores: {
          romantic: 0.5,
          action: 0.6,
          family: 0.5,
          chill: 0.5,
          novelty: 1,
          social: 0.9,
        },
        source: 'mock',
        bookable: true,
      });
    }
    return out.slice(0, query.limit ?? 5);
  }
}
