import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './features/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#171412',
          soft: '#4a423d',
          muted: '#8b807a',
          faint: '#b6aca6',
        },
        canvas: {
          DEFAULT: '#fbf8f5',
          raised: '#ffffff',
          sunk: '#f3eee9',
        },
        line: '#ece5de',
        brand: {
          50: '#fff3ec',
          100: '#ffe3d3',
          200: '#ffc4a6',
          300: '#ff9f6f',
          400: '#fc7a3e',
          500: '#f15c1c',
          600: '#dc4510',
          700: '#b6330f',
          800: '#912a14',
          900: '#752614',
        },
        mint: {
          100: '#dff5ec',
          300: '#8fd9c2',
          500: '#3aab88',
          700: '#1f7b60',
        },
        sky: {
          100: '#e2effd',
          300: '#a3cbf7',
          500: '#4f92e0',
          700: '#2a5f9e',
        },
        plum: {
          100: '#f1e8fb',
          300: '#cdb2ef',
          500: '#9166d0',
          700: '#63428f',
        },
        sun: {
          100: '#fdf0cf',
          300: '#f7d068',
          500: '#e0a412',
          700: '#9c6f08',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.35rem',
        '3xl': '1.75rem',
        '4xl': '2.25rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(23,20,18,0.04), 0 8px 24px -12px rgba(23,20,18,0.18)',
        lift: '0 2px 6px rgba(23,20,18,0.06), 0 18px 40px -18px rgba(23,20,18,0.28)',
        press: 'inset 0 1px 2px rgba(23,20,18,0.08)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.7' },
          '50%': { transform: 'scale(1.06)', opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22,1,0.36,1) both',
        shimmer: 'shimmer 1.6s infinite',
        breathe: 'breathe 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
