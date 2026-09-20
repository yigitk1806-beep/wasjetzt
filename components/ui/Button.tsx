'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet';
type Size = 'sm' | 'md' | 'lg';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  full?: boolean;
};

const VARIANTS: Record<Variant, string> = {
  primary:
    'text-white bg-gradient-to-br from-brand-400 to-brand-600 shadow-lift hover:from-brand-300 hover:to-brand-500',
  secondary: 'bg-canvas-raised text-ink hairline shadow-card hover:bg-white',
  ghost: 'bg-canvas-sunk text-ink-soft hover:bg-line',
  quiet: 'bg-transparent text-ink-muted hover:text-ink',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[0.86rem] rounded-xl gap-1.5',
  md: 'h-12 px-5 text-[0.95rem] rounded-2xl gap-2',
  lg: 'h-14 px-6 text-base rounded-2xl gap-2.5',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading,
    icon,
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
        'tap inline-flex items-center justify-center font-semibold',
        'disabled:opacity-55 disabled:pointer-events-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        VARIANTS[variant],
        SIZES[size],
        full ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80 ${className}`}
    />
  );
}
