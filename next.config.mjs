/**
 * Sicherheits-Header für jede Antwort.
 *
 * Bewusst ohne Content-Security-Policy: Die Karte lädt Kacheln von einem
 * frei konfigurierbaren Server (`NEXT_PUBLIC_TILE_URL`), Leaflet setzt
 * Inline-Styles, und Next.js braucht für eine strenge Richtlinie Nonces in
 * jedem Render. Eine halbherzige CSP mit `unsafe-inline` schützt kaum und
 * bricht leicht die Karte – das wäre die schlechtere Wahl. Offener Punkt in
 * WASJETZ_PRODUCTION_CHECKLIST.md.
 */
const SICHERHEITS_HEADER = [
  // Keine Typ-Ratespiele des Browsers bei Antworten.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // WasJetzt lässt sich nicht in fremde Seiten einbetten (Clickjacking).
  { key: 'X-Frame-Options', value: 'DENY' },
  // Fremde Seiten erfahren beim Klick auf einen Link nur die Herkunft,
  // nicht die Plan-Adresse samt Kennung.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Standort darf nur die App selbst abfragen. Kamera und Mikrofon braucht
  // sie gar nicht.
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['motion'],
  },
  async headers() {
    return [{ source: '/(.*)', headers: SICHERHEITS_HEADER }];
  },
};

export default nextConfig;
