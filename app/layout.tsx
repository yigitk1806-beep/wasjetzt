import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { BottomNav } from '@/components/BottomNav';
import { LocaleProvider } from '@/components/LocaleProvider';
import { dictionaryFor } from '@/lib/i18n';
import { requestLocale } from '@/lib/i18n/server';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

/** Titel und Beschreibung in der Sprache des Besuchers. */
export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await requestLocale();
  const t = dictionaryFor(locale);
  return {
    title: t.meta.title,
    description: t.meta.description,
    applicationName: 'WasJetzt',
    appleWebApp: { capable: true, title: 'WasJetzt', statusBarStyle: 'default' },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: '#fbf8f5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, chosen } = await requestLocale();
  return (
    <html lang={locale} className={inter.variable}>
      <body>
        <LocaleProvider initialLocale={locale} chosen={chosen}>
          <div className="min-h-dvh pb-24">{children}</div>
          <BottomNav />
        </LocaleProvider>
      </body>
    </html>
  );
}
