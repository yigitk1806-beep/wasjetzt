/**
 * Overpass-Attrappe fuer die Ausfalltests.
 *
 * Antwortet je nach eingestelltem Modus wie eine ueberlastete oder kaputte
 * Instanz. Der Modus wird zur Laufzeit per GET /modus?m=... umgestellt, damit
 * ein einziger Entwicklungsserver gegen alle Faelle geprueft werden kann.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 3999);
let modus = 'ok';
/** Alle empfangenen Abfragen - damit Tests pruefen koennen, wonach die App
 *  ueberhaupt fragt, nicht nur was sie mit der Antwort macht. Ein Planlauf
 *  schickt mehrere: Orte, Sehenswuerdigkeiten, weitere Zellen. */
let abfragen = [];

// Zwei echte Orte in Laufweite der Ackerstrasse 66, taeglich 10-23 Uhr offen.
const ELEMENTE = [
  {
    type: 'node', id: 900000001, lat: 52.5380, lon: 13.3870,
    tags: { name: 'Teststube', amenity: 'restaurant', cuisine: 'german', opening_hours: 'Mo-Su 10:00-23:00' },
  },
  {
    type: 'node', id: 900000002, lat: 52.5368, lon: 13.3880,
    tags: { name: 'Bowling Pruefstand', leisure: 'bowling_alley', opening_hours: 'Mo-Su 10:00-23:00' },
  },
  {
    type: 'node', id: 900000003, lat: 52.5390, lon: 13.3850,
    tags: { name: 'Testcafe', amenity: 'cafe', opening_hours: 'Mo-Su 08:00-20:00' },
  },
  // Die drei Faelle, auf die es beim Gluecksspiel ankommt. Bewusst mit
  // neutralen Namen: Geprueft wird die Zuordnung ueber das OSM-Tag, nicht
  // ueber eine Namensliste.
  {
    type: 'node', id: 900000010, lat: 52.5378, lon: 13.3872,
    tags: { name: 'Videohalle Nord', leisure: 'amusement_arcade', opening_hours: 'Mo-Su 10:00-22:00' },
  },
  {
    type: 'node', id: 900000011, lat: 52.5373, lon: 13.3858,
    tags: { name: 'Automatenhof Sued', leisure: 'adult_gaming_centre', opening_hours: 'Mo-Su 10:00-22:00' },
  },
  {
    type: 'node', id: 900000012, lat: 52.5382, lon: 13.3861,
    tags: { name: 'Grosse Spielbank', amenity: 'casino', opening_hours: 'Mo-Su 10:00-22:00' },
  },
  // Damit "Station ersetzen" ueberhaupt eine Alternative hat. Ohne einen
  // zweiten harmlosen Aktivitaetsort antwortet die Route mit
  // "no-alternative", und der Testfall waere nicht entscheidbar.
  {
    type: 'node', id: 900000013, lat: 52.5369, lon: 13.3880,
    tags: { name: 'Kegelbahn West', leisure: 'bowling_alley', opening_hours: 'Mo-Su 10:00-22:00' },
  },
  // Gewoehnliche Freizeitangebote, die weiter funktionieren muessen.
  {
    type: 'node', id: 900000014, lat: 52.5371, lon: 13.3866,
    tags: { name: 'Minigolf Mitte', leisure: 'miniature_golf', opening_hours: 'Mo-Su 10:00-22:00' },
  },
  {
    type: 'node', id: 900000015, lat: 52.5377, lon: 13.3855,
    tags: { name: 'Sprungbude Nord', leisure: 'trampoline_park', opening_hours: 'Mo-Su 10:00-22:00' },
  },
  // Der schwierige Fall: kommt ueber ein harmloses Zweit-Tag herein und ist
  // trotzdem Gluecksspiel. Hier reicht es nicht, die Abfrage zu kuerzen.
  {
    type: 'node', id: 900000016, lat: 52.5374, lon: 13.3869,
    tags: {
      name: 'Sportpalast Ost', leisure: 'sports_centre', amenity: 'casino',
      opening_hours: 'Mo-Su 10:00-22:00',
    },
  },
  // Wettbuero: steht in keiner Abfrage, faellt nur ueber das Tag auf.
  {
    type: 'node', id: 900000017, lat: 52.5366, lon: 13.3871,
    tags: {
      name: 'Tippstube Sued', leisure: 'sports_centre', sport: 'billiards',
      shop: 'bookmaker',
      opening_hours: 'Mo-Su 10:00-22:00',
    },
  },
  // Sehenswuerdigkeit, die zugleich Spielbank ist - der Tour-Pfad.
  {
    type: 'node', id: 900000018, lat: 52.5380, lon: 13.3858,
    tags: {
      name: 'Kurhaus Alt', tourism: 'attraction', amenity: 'casino',
      opening_hours: 'Mo-Su 10:00-22:00',
    },
  },
  // Harmlose Sehenswuerdigkeiten, damit eine Tour ueberhaupt zustande kommt.
  // `buildTour` verlangt mindestens ZWEI im fertigen Weg - mit nur zwei
  // Kandidaten kippt die Tour, sobald einer an Oeffnungszeit oder Wetter
  // haengen bleibt. Deshalb vier, alle mit Wikipedia-Tag: Die
  // Sehenswuerdigkeiten-Abfrage verlangt `["wikipedia"]`.
  {
    type: 'node', id: 900000019, lat: 52.5379, lon: 13.3863,
    tags: {
      name: 'Pruefmuseum', tourism: 'museum', opening_hours: 'Mo-Su 10:00-20:00',
      wikipedia: 'de:Pruefmuseum',
    },
  },
  {
    type: 'node', id: 900000020, lat: 52.5370, lon: 13.3859,
    tags: { name: 'Hoher Blick', tourism: 'viewpoint', wikipedia: 'de:Hoher Blick' },
  },
  {
    type: 'node', id: 900000022, lat: 52.5384, lon: 13.3870,
    tags: {
      name: 'Alter Turm', historic: 'tower', wikipedia: 'de:Alter Turm',
      opening_hours: 'Mo-Su 09:00-21:00',
    },
  },
  {
    type: 'node', id: 900000023, lat: 52.5367, lon: 13.3864,
    tags: {
      name: 'Pruefkirche', amenity: 'place_of_worship', historic: 'church',
      wikipedia: 'de:Pruefkirche', opening_hours: 'Mo-Su 08:00-19:00',
    },
  },
  // Zwei weitere, damit "Station ersetzen" in der Tour ueberhaupt eine
  // Alternative hat - sonst antwortet die Route mit "no-alternative" und
  // der Testfall waere leer bestanden.
  {
    type: 'node', id: 900000024, lat: 52.5386, lon: 13.3852,
    tags: {
      name: 'Zweitmuseum', tourism: 'museum', wikipedia: 'de:Zweitmuseum',
      opening_hours: 'Mo-Su 09:00-21:00',
    },
  },
  {
    type: 'node', id: 900000025, lat: 52.5364, lon: 13.3853,
    tags: {
      name: 'Denkmal Mitte', historic: 'monument', wikipedia: 'de:Denkmal Mitte',
    },
  },
  // Die Gegenprobe zum Tag `gambling`: Diese Kneipe sagt ausdruecklich,
  // dass es bei ihr KEINE Automaten gibt. Sie muss zulaessig bleiben.
  {
    type: 'node', id: 900000021, lat: 52.5372, lon: 13.3876,
    tags: {
      name: 'Ehrliche Kneipe', amenity: 'pub', gambling: 'no',
      opening_hours: 'Mo-Su 16:00-02:00',
    },
  },
];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/modus') {
    modus = url.searchParams.get('m') ?? 'ok';
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('modus=' + modus);
    console.log('[stub] Modus ->', modus);
    return;
  }

  if (url.pathname === '/letzte') {
    if (url.searchParams.get('leeren') === '1') abfragen = [];
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(abfragen.join('\n---\n'));
    return;
  }

  // Anfragekoerper abholen, damit der Client nicht blockiert.
  const teile = [];
  await new Promise((f) => {
    req.on('data', (c) => teile.push(c));
    req.on('end', f);
  });
  if (teile.length) abfragen.push(Buffer.concat(teile).toString('utf8'));
  console.log('[stub] Anfrage, Modus', modus);

  switch (modus) {
    case 'ok':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ elements: ELEMENTE }));
      return;
    case 'timeout':
      // Gar nicht antworten: Der Client muss ins Zeitlimit laufen.
      return;
    case '429':
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Too Many Requests');
      return;
    case '504':
      res.writeHead(504, { 'Content-Type': 'text/plain' });
      res.end('Gateway Timeout');
      return;
    case '500':
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
      return;
    case 'leer':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ elements: [] }));
      return;
    case 'muell':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('<html>kein JSON</html>');
      return;
    default:
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ elements: ELEMENTE }));
  }
});

server.listen(PORT, () => console.log(`[stub] hoert auf ${PORT}`));
