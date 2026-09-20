'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from './LocaleProvider';

const ITEMS = [
  { href: '/', key: 'home', icon: HomeIcon },
  { href: '/plaene', key: 'plans', icon: ListIcon },
  { href: '/profil', key: 'profile', icon: UserIcon },
] as const;

/**
 * Drei Einträge, mehr nicht. Auf der Plan-Ansicht blendet sich die Navigation
 * aus, damit dort nur eine Hauptaktion sichtbar bleibt.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { t } = useLocale();

  if (pathname.startsWith('/plan/') || pathname.startsWith('/planen')) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 pointer-events-none">
      <div className="shell safe-bottom pointer-events-auto">
        <div className="mb-2 flex items-center justify-around rounded-3xl border border-line/80 bg-canvas-raised/85 px-2 py-1.5 shadow-card backdrop-blur-xl">
          {ITEMS.map(({ href, key, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={[
                  'tap flex flex-1 flex-col items-center gap-1 rounded-2xl py-2 text-[0.68rem] font-medium',
                  active ? 'text-ink' : 'text-ink-faint',
                ].join(' ')}
              >
                <Icon active={active} />
                {t.nav[key]}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

type IconProps = { active: boolean };

function HomeIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10.4 12 4l8 6.4V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.12 : 0}
      />
    </svg>
  );
}

function ListIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="4"
        y="5"
        width="16"
        height="14"
        rx="3.2"
        stroke="currentColor"
        strokeWidth="1.7"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.12 : 0}
      />
      <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function UserIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        cx="12"
        cy="9"
        r="3.4"
        stroke="currentColor"
        strokeWidth="1.7"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.12 : 0}
      />
      <path
        d="M5.5 19.5c1-3.4 3.6-5 6.5-5s5.5 1.6 6.5 5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
