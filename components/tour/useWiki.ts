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
export function useWiki(artikel: string | undefined): WikiInfo | null | undefined {
  const [info, setInfo] = useState<WikiInfo | null | undefined>(() =>
    artikel ? geladen.get(artikel) : null,
  );

  useEffect(() => {
    if (!artikel) {
      setInfo(null);
      return;
    }
    const vorhanden = geladen.get(artikel);
    if (vorhanden) {
      setInfo(vorhanden);
      return;
    }

    let aktiv = true;
    setInfo(undefined);
    fetch(`/api/wiki?t=${encodeURIComponent(artikel)}`)
      .then((res) => (res.ok ? (res.json() as Promise<WikiInfo>) : null))
      .then((data) => {
        const wert = data ?? { text: null, bild: null, link: null };
        geladen.set(artikel, wert);
        if (aktiv) setInfo(wert);
      })
      .catch(() => {
        if (aktiv) setInfo(null);
      });
    return () => {
      aktiv = false;
    };
  }, [artikel]);

  return info;
}
