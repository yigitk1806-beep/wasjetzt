'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Uhrzeit wählen – mit dem nativen Zeitpicker des Handys.
 *
 * Sichtbar ist eine klare Zeile („Jetzt · 07:35", „22:00 Uhr"), darüber liegt
 * unsichtbar ein echtes `<input type="time">`. Ein Tipp irgendwo auf die Zeile
 * trifft also das Eingabefeld selbst: iOS zeigt das Drehrad, Android die Uhr.
 * Das ist verlässlicher als ein Feld per Skript zu öffnen, und es sieht nie
 * wie ein leeres Formularfeld aus.
 */

type Props = {
  icon: ReactNode;
  label: string;
  /** "14:30" oder `null` für den Grundzustand (jetzt / keine Endzeit). */
  value: string | null;
  /** Text im Grundzustand. */
  emptyText: string;
  /** Text bei gesetzter Uhrzeit. */
  valueText: (value: string) => string;
  /** Aufforderung rechts, etwa „Startzeit ändern". */
  actionText: string;
  /** Beschriftung zum Zurücksetzen, etwa „Jetzt". */
  resetText: string;
  onChange: (value: string | null) => void;
  /** Womit der Picker startet, solange nichts gewählt ist. */
  pickerDefault: string;
  /**
   * Beim Schließen des Pickers übernehmen, auch wenn nicht gedreht wurde.
   * Sonst passiert auf iOS nichts, wenn der Vorschlag schon passt.
   */
  commitOnBlur?: boolean;
  /** Schmale Pillenform für Seiten ohne eigenen Einstellungsbereich. */
  compact?: boolean;
};

export function TimeField({
  icon,
  label,
  value,
  emptyText,
  valueText,
  actionText,
  resetText,
  onChange,
  pickerDefault,
  commitOnBlur = false,
  compact = false,
}: Props) {
  const text = value ? valueText(value) : emptyText;

  const input = (
    <input
      type="time"
      aria-label={label}
      value={value ?? pickerDefault}
      onChange={(e) => {
        if (e.target.value) onChange(e.target.value);
      }}
      onBlur={(e) => {
        if (commitOnBlur && !value && e.target.value) onChange(e.target.value);
      }}
      onClick={(e) => {
        // Am Desktop öffnet ein Klick allein keinen Picker.
        try {
          (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
        } catch {
          /* ältere Browser: Fokus reicht */
        }
      }}
      // 16 px verhindert, dass iOS beim Antippen in die Seite hineinzoomt.
      style={{ fontSize: 16 }}
      className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
    />
  );

  const zuruecksetzen = value ? (
    <button
      type="button"
      onClick={() => onChange(null)}
      className={[
        'tap relative z-10 shrink-0 rounded-full bg-canvas-sunk font-semibold text-ink-soft',
        compact ? 'ml-0.5 grid h-6 w-6 place-items-center text-[0.8rem]' : 'px-3 py-1.5 text-[0.78rem]',
      ].join(' ')}
      aria-label={`${label}: ${resetText}`}
    >
      {compact ? '×' : resetText}
    </button>
  ) : null;

  if (compact) {
    return (
      <span className="relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-canvas-raised pl-3.5 pr-2 text-[0.84rem] shadow-card hairline">
        <span aria-hidden>{icon}</span>
        <span className="whitespace-nowrap font-semibold tabular-nums text-ink-soft">{text}</span>
        {input}
        {zuruecksetzen ?? <span className="w-1.5" aria-hidden />}
      </span>
    );
  }

  return (
    <div className="relative flex items-center gap-3 rounded-2xl bg-canvas-raised px-3.5 py-3 shadow-card hairline">
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-canvas-sunk text-lg"
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.76rem] font-medium text-ink-muted">{label}</span>
        <span className="block truncate text-[1.02rem] font-semibold tabular-nums">{text}</span>
        <span className="mt-0.5 block text-[0.76rem] font-semibold text-brand-600">{actionText}</span>
      </span>
      {zuruecksetzen}
      {input}
    </div>
  );
}

/**
 * Aktuelle Uhrzeit des Geräts als "07:35" – aktualisiert sich selbst.
 *
 * Beim ersten Rendern leer: Die Seite wird auf dem Server vorgerendert, und
 * dessen Uhrzeit (UTC, zum Zeitpunkt des Builds) passt nie zu der im Browser.
 */
export function useNowClock(): string {
  const [jetzt, setJetzt] = useState('');
  useEffect(() => {
    setJetzt(clockOf(new Date()));
    const timer = setInterval(() => setJetzt(clockOf(new Date())), 20_000);
    return () => clearInterval(timer);
  }, []);
  return jetzt;
}

/** "Jetzt · 07:35" – solange die Uhrzeit noch nicht bekannt ist, nur "Jetzt". */
export function jetztText(jetzt: string, prefix = 'Jetzt'): string {
  return jetzt ? `${prefix} · ${jetzt}` : prefix;
}

export function clockOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function minutesOf(clock: string): number {
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + m;
}

export function clockFromMin(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "Heute · 14:30" oder "Morgen · 09:00" – aus Sicht des Geräts. */
export function startLabel(clock: string, now = new Date()): string {
  const jetzt = now.getHours() * 60 + now.getMinutes();
  return `${minutesOf(clock) < jetzt - 10 ? 'Morgen' : 'Heute'} · ${clock}`;
}

/** Nächste Viertelstunde nach `jetzt` – Vorschlag für den Startzeit-Picker. */
export function nextQuarter(jetzt: string): string {
  if (!jetzt) return '12:00';
  return clockFromMin(Math.ceil((minutesOf(jetzt) + 5) / 15) * 15);
}

/** Minuten seit Mitternacht der Startzeit – gewählt oder jetzt; `null`, solange unbekannt. */
export function startMinutes(startAt: string | null, jetzt: string): number | null {
  if (startAt) return minutesOf(startAt);
  return jetzt ? minutesOf(jetzt) : null;
}
