import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { BottomNav } from '@/components/BottomNav';
import { LocaleProvider } from '@/components/LocaleProvider';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'WasJetzt – Mehr erleben. Weniger planen.',
  description:
    'WasJetzt schlägt dir in Sekunden vor, was ihr jetzt machen könnt – passend zu Uhrzeit, Wetter, Budget und Umgebung.',
  applicationName: 'WasJetzt',
  appleWebApp: { capable: true, title: 'WasJetzt', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#fbf8f5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={inter.variable}>
      <body>
        <LocaleProvider>
          <div className="min-h-dvh pb-24">{children}</div>
          <BottomNav />
        </LocaleProvider>
      </body>
    </html>
  );
}
