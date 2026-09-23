'use client';

import { useEffect, useState } from 'react';

export type WikiInfo = {
  text: string | null;
  bild: string | null;
  link: string | null;
};

/** Pro Sitzung nur einmal laden – beim Ersetzen bleiben die anderen Stationen stehen. */
const geladen = new Map<string, WikiInfo>();

/**
 * Kurzbeschreibung und Bild einer Station aus dem verknüpften
 * Wikipedia-Artikel. `undefined` solange geladen wird, `null` ohne Artikel.
 */
export function useWiki(artikel: string | undefined, sprache: string): WikiInfo | null | undefined {
  // Pro Sprache eigener Eintrag – Text und Artikel hängen an der Sprache.
  const schluessel = artikel ? `${sprache}|${artikel}` : undefined;
  const [info, setInfo] = useState<WikiInfo | null | undefined>(() =>
    schluessel ? geladen.get(schluessel) : null,
  );

  useEffect(() => {
    if (!artikel || !schluessel) {
      setInfo(null);
      return;
    }
    const vorhanden = geladen.get(schluessel);
    if (vorhanden) {
      setInfo(vorhanden);
      return;
    }

    let aktiv = true;
    setInfo(undefined);
    fetch(`/api/wiki?t=${encodeURIComponent(artikel)}&lang=${encodeURIComponent(sprache)}`)
      .then((res) => (res.ok ? (res.json() as Promise<WikiInfo>) : null))
      .then((data) => {
        const wert = data ?? { text: null, bild: null, link: null };
        geladen.set(schluessel, wert);
        if (aktiv) setInfo(wert);
      })
      .catch(() => {
        if (aktiv) setInfo(null);
      });
    return () => {
      aktiv = false;
    };
  }, [artikel, schluessel, sprache]);

  return info;
}
