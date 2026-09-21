'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet';
type Size = 'sm' | 'md' | 'lg';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Steht links vom Text. */
  icon?: ReactNode;
  /** Steht rechts vom Text – etwa ein Pfeil bei der Hauptaktion. */
  trailingIcon?: ReactNode;
  /** Text während des Ladens. Ohne Angabe bleibt der normale Text stehen. */
  loadingLabel?: ReactNode;
  full?: boolean;
};

const VARIANTS: Record<Variant, string> = {
  // Warmer Verlauf innerhalb des Orange, Schatten in der Buttonfarbe.
  // Beim Zeigen hebt sich der Button leicht, beim Drücken sinkt er zurück –
  // dezent genug, dass es sich nach Material anfühlt und nicht nach Effekt.
  primary: [
    'text-white bg-gradient-to-b from-brand-400 via-brand-500 to-brand-600 shadow-brand',
    'hover:from-brand-300 hover:via-brand-400 hover:to-brand-500 hover:shadow-brand-lg hover:-translate-y-[1.5px]',
    'active:translate-y-0 active:shadow-brand',
  ].join(' '),
  secondary: 'bg-canvas-raised text-ink hairline shadow-card hover:bg-white',
  ghost: 'bg-canvas-sunk text-ink-soft hover:bg-line',
  quiet: 'bg-transparent text-ink-muted hover:text-ink',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[0.86rem] rounded-xl gap-1.5',
  md: 'h-12 px-5 text-[0.95rem] rounded-2xl gap-2',
  lg: 'h-[3.5rem] px-7 text-[1.02rem] rounded-[1.15rem] gap-2.5 tracking-tight',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading,
    icon,
    trailingIcon,
    loadingLabel,
    full,
    className = '',
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center font-semibold',
        'transition-[transform,box-shadow,background-color,opacity] duration-200 ease-out',
        'active:scale-[0.985] active:duration-75',
        'disabled:opacity-60 disabled:pointer-events-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        VARIANTS[variant],
        SIZES[size],
        full ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <>
          {loadingLabel ?? children}
          <ThinkingDots />
        </>
      ) : (
        <>
          {icon}
          {children}
          {trailingIcon}
        </>
      )}
    </button>
  );
});

/**
 * Drei Punkte, die nacheinander aufleuchten – als Zeichen, dass nachgedacht
 * wird, nicht dass etwas hängt. Ersetzt den Spinner in der Hauptaktion.
 */
function ThinkingDots() {
  return (
    <span className="ml-0.5 inline-flex items-end gap-[3px] pb-[3px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block h-[3px] w-[3px] animate-dot rounded-full bg-current"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80 ${className}`}
    />
  );
}
