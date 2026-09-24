'use client';

import { Chip } from '@/components/ui/Chip';
import { useLocale } from '@/components/LocaleProvider';
import { distance } from '@/lib/i18n/format';

/** Stufen in Metern. Bewusst grob – eine Feineinstellung hilft niemandem. */
export const RADIEN = [500, 1000, 2000, 5000, 10_000, 20_000, 50_000] as const;

/** Voreinstellung, solange der Nutzer nichts gewählt hat. */
export const RADIUS_STANDARD = 2000;

type Props = {
  value: number;
  onChange: (meters: number) => void;
};

/**
 * Wie weit darf es weg sein?
 *
 * Die Wahl ist eine Zusage: Wer 2 km sagt, bekommt nichts aus 5 km. Findet
 * sich innerhalb nichts, sagt der Plan das – und bietet an, den Umkreis zu
 * vergrößern. Von selbst tut die Engine es nicht.
 */
export function RadiusField({ value, onChange }: Props) {
  const { t } = useLocale();

  return (
    <div className="space-y-2">
      <div className="-mx-[1.15rem] edge-fade">
        <div className="scroll-x gap-2 px-[1.15rem]">
          {RADIEN.map((m) => (
            <Chip key={m} selected={value === m} onClick={() => onChange(m)}>
              {distance(t, m)}
            </Chip>
          ))}
        </div>
      </div>
      <p className="px-1 text-[0.82rem] font-medium text-ink-soft">
        📍 {t.build.radiusValue(distance(t, value))}
      </p>
    </div>
  );
}
