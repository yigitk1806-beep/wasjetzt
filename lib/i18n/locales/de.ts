/**
 * Deutsch – die Referenz. Jede andere Sprache muss exakt diese Form haben;
 * TypeScript meldet fehlende oder überzählige Schlüssel.
 *
 * Feste Texte sind Strings, alles mit Zahlen, Uhrzeiten oder Namen ist eine
 * kleine Funktion. So bleibt Grammatik (Einzahl/Mehrzahl, Satzstellung) in
 * der jeweiligen Sprache – und nicht im Code der Komponenten.
 */

export type Party = 'solo' | 'partner' | 'friends' | 'family';
export type DayPart = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
export type TravelMode = 'walk' | 'bike' | 'transit' | 'car';

export const de = {
  code: 'de',
  meta: {
    title: 'WasJetzt – Mehr erleben. Weniger planen.',
    description:
      'WasJetzt schlägt dir in Sekunden vor, was ihr jetzt machen könnt – passend zu Uhrzeit, Wetter, Budget und Umgebung.',
    tagline: 'Mehr erleben. Weniger planen.',
  },

  units: {
    /** 190 → "3 Std. 10 Min." */
    duration: (h: number, m: number) =>
      h === 0 ? `${m} Min.` : m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`,
    /** Uhrzeit im Fließtext – im Deutschen mit "Uhr". */
    clock: (time: string) => `${time} Uhr`,
    decimal: 'de-DE',
  },

  days: {
    today: 'Heute',
    tomorrow: 'Morgen',
    yesterday: 'Gestern',
    weekdays: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  },

  common: {
    back: 'Zurück',
    close: 'Schließen',
    share: 'Teilen',
    copy: 'Kopieren',
    copied: 'Kopiert',
    approx: 'ca.',
    demo: 'Demo',
    noConnection: 'Keine Verbindung. Versuch es gleich nochmal.',
  },

  nav: { home: 'Start', plans: 'Pläne', profile: 'Profil', label: 'Hauptnavigation' },

  location: {
    locating: 'Standort …',
    denied: 'Kein Standort – such dir einen Ort aus.',
    choose: 'Ort wählen',
    search: 'Stadt oder Ort suchen',
    useCurrent: 'Aktuellen Standort verwenden',
    yours: 'Dein Standort',
  },

  home: {
    headline: 'Was machen wir?',
    now: 'Jetzt los',
    nowHint: 'Keine Fragen. Direkt ein Vorschlag.',
    build: 'Plan erstellen',
    buildHint: 'Sag kurz, was ihr wollt.',
    surprise: 'Überrasch mich',
    surpriseHint: 'WasJetzt entscheidet.',
    discover: 'Sehenswürdigkeiten',
    discoverHint: 'Entdecke deine Stadt – als fertige Tour',
    nearby: 'In deiner Nähe',
    lastPlan: 'Zuletzt geplant',
    deals: 'Jetzt günstig',
    /** "Wie sonst montags: etwas Entspanntes?" */
    routine: (weekday: number, mood: string) =>
      `Wie sonst ${['sonntags', 'montags', 'dienstags', 'mittwochs', 'donnerstags', 'freitags', 'samstags'][weekday]}: ${mood}?`,
    routineMood: {
      date: 'etwas Romantisches',
      action: 'etwas mit Action',
      chill: 'etwas Entspanntes',
      party: 'etwas zum Feiern',
      food: 'etwas Essen',
      nature: 'raus in die Natur',
      gaming: 'etwas zum Zocken',
      new: 'etwas Neues',
    },
    tiles: {
      food: 'Essen',
      activity: 'Aktivität',
      cinema: 'Kino',
      cafe: 'Café',
      nature: 'Draußen',
      gaming: 'Gaming',
    },
    dealDiscount: (percent: number) => `Heute ${percent} % günstiger`,
  },

  categories: {
    food: 'Essen',
    cafe: 'Café',
    bar: 'Bar',
    activity: 'Aktivität',
    cinema: 'Kino',
    culture: 'Kultur',
    nature: 'Natur',
    sport: 'Sport',
    gaming: 'Gaming',
    wellness: 'Wellness',
    shopping: 'Bummeln',
    event: 'Event',
  },

  build: {
    title: 'Was habt ihr vor?',
    freeText: 'Oder sag es einfach:',
    freeTextPlaceholder: 'z. B. „Wir sind zu zweit, 50 € und wollen was Verrücktes“',
    who: 'Mit wem?',
    time: 'Wie viel Zeit?',
    budget: 'Budget',
    mood: 'Stimmung',
    more: 'Mehr Einstellungen',
    mobility: 'Wie unterwegs?',
    single: 'Nur eine Sache',
    submit: 'Plan erstellen',
    submitting: 'Plan wird erstellt',
    parties: { solo: 'Alleine', partner: 'Zu zweit', friends: 'Freunde', family: 'Familie' },
    times: { 90: '1–2 Std.', 180: '2–4 Std.', 300: '4–6 Std.', 480: 'Ganzer Tag' },
    budgets: {
      free: 'Kostenlos',
      low: 'bis 20 €',
      medium: 'bis 50 €',
      high: 'bis 100 €',
      any: 'Egal',
    },
    moods: {
      date: 'Date',
      action: 'Action',
      chill: 'Entspannt',
      party: 'Party',
      food: 'Essen',
      nature: 'Natur',
      gaming: 'Gaming',
      new: 'Neu',
    },
    mobilities: { walk: 'Fuß', bike: 'Rad', transit: 'Bus & Bahn', car: 'Auto' },
    summaryStart: (time: string) => `Start ${time}`,
    summaryHome: (time: string) => `Zuhause ${time}`,
    windowLeft: (duration: string) => `Bis dahin bleiben ${duration} – der Rückweg wird eingerechnet.`,
    windowTight: 'Das ist sehr knapp – mit Hin- und Rückweg bleibt kaum Zeit.',
  },

  time: {
    startLabel: 'Wann starten?',
    now: 'Jetzt',
    nowAt: (time: string) => `Jetzt · ${time}`,
    change: 'Ändern',
    changeStart: 'Startzeit ändern',
    homeLabel: 'Zuhause bis',
    homeNone: 'Keine feste Endzeit',
    homeSet: 'Festlegen',
    homeClear: 'Keine',
    homeValue: (time: string) => `${time} Uhr`,
    /** "Heute · 14:30" */
    startValue: (day: 'today' | 'tomorrow', time: string) =>
      `${day === 'today' ? 'Heute' : 'Morgen'} · ${time}`,
    compactStartNow: (time: string) => (time ? `Start jetzt · ${time}` : 'Start jetzt'),
    compactStart: (day: 'today' | 'tomorrow', time: string) =>
      `Start ${day === 'today' ? 'heute' : 'morgen'} ${time}`,
    compactHomeNone: 'Zuhause bis …',
    compactHome: (time: string) => `Zuhause ${time}`,
    sheetTitle: 'Zeit ändern',
    sheetNote: 'Die Stationen bleiben – nur was zur neuen Zeit geschlossen hat oder nicht mehr passt, wird ersetzt.',
    sheetTomorrow: 'Der Plan liegt auf morgen.',
    apply: 'Übernehmen',
    applying: 'Wird verschoben',
    reset: (label: string) => `${label}: zurücksetzen`,
  },

  overlay: {
    searching: 'Wir suchen gerade etwas Gutes für euch …',
    almost: 'Fast fertig …',
    phases: {
      orte: { short: 'Orte', text: 'Orte finden …' },
      wetter: { short: 'Wetter', text: 'Wetter prüfen …' },
      wege: { short: 'Wege', text: 'Wege berechnen …' },
      plan: { short: 'Plan', text: 'Plan erstellen …' },
    },
  },

  plan: {
    changeTime: 'Zeit ändern',
    stops: (n: number) => `${n} ${n === 1 ? 'Station' : 'Stationen'}`,
    inclReturn: 'inkl. Rückweg',
    airline: (distance: string) => `${distance} Luftlinie`,
    go: "Los geht's",
    feedback: "Wie war's?",
    variants: 'Andere Richtung',
    variantNames: { balanced: 'Ausgewogen', romantic: 'Romantisch', action: 'Action', cheap: 'Günstig' },
    mockNotice:
      'Demo-Daten: Orte, Preise und Öffnungszeiten in diesem Plan sind Beispiele und gehören zu keinem echten Betrieb. Wetter und Entfernungen sind echt berechnet.',
    weatherChanged: 'Das Wetter hat sich geändert.',
    weatherChangedHint: 'Der geplante Outdoor-Teil könnte nass werden.',
    adjust: 'Plan anpassen',
    fine: 'Passt schon',
    departAt: (time: string) => `Los um ${time} ·`,
    directHere: 'direkt hier',
    homeAt: (time: string, approx: boolean) => `Zuhause ${approx ? 'ca.' : 'um'} ${time}`,
    returnWay: (duration: string, approx: boolean) => `Rückweg ${approx ? 'ca. ' : ''}${duration}`,
    hoursUnknown: 'Öffnungszeiten nicht verfügbar',
    replace: 'Ersetzen',
    replaceAria: (name: string) => `${name} ersetzen`,
    noAlternative: 'Keine Alternative gefunden.',
  },

  price: {
    free: 'kostenlos',
    mostlyFree: 'meist kostenlos',
    estimated: (symbols: string) => `${symbols} geschätzt`,
    perPerson: (price: string) => `${price} p. P.`,
  },

  map: {
    routed: (distance: string, duration: string, mode: string) =>
      `${distance} Gesamtweg · ca. ${duration} ${mode}`,
    partial: (distance: string) => `ca. ${distance} Gesamtweg · teils geschätzt`,
    airline: (distance: string) => `${distance} Luftlinie insgesamt`,
    navigate: 'Navigation starten',
    aria: (n: number) => `Karte mit ${n} Stationen`,
    modes: { walk: 'zu Fuß', bike: 'mit dem Rad', transit: 'mit Bus & Bahn', car: 'mit dem Auto' },
  },

  replace: {
    title: (name: string) => `${name} ersetzen`,
    note: 'Der Rest des Plans bleibt, wie er ist.',
    noteTour: 'Der Rest der Tour bleibt, nur die Zeiten danach verschieben sich.',
    options: {
      any: 'Etwas anderes',
      cheaper: 'Günstiger',
      faster: 'Schneller',
      romantic: 'Romantischer',
      action: 'Mehr Action',
      indoor: 'Drinnen',
      new: 'Etwas Neues',
    },
    tourOptions: {
      any: 'Etwas anderes',
      indoor: 'Lieber drinnen',
      new: 'Ein Geheimtipp',
      cheaper: 'Kostenlos',
    },
  },

  share: {
    title: 'Plan teilen',
    intro: 'Wer den Link öffnet, sieht den Plan sofort – ganz ohne Anmeldung.',
    email: 'E-Mail',
    validUntil: (date: string) => `Der Link funktioniert bis ${date} Uhr.`,
  },

  feedback: {
    title: "Wie war's?",
    thanks: 'Danke – merke ich mir. 👍',
    good: 'Gut',
    bad: 'Nicht gut',
    why: "Woran lag's?",
    reasons: { price: 'Zu teuer', distance: 'Zu weit', atmosphere: 'Atmosphäre', quality: 'Qualität' },
    skip: 'Sag ich nicht',
  },

  group: {
    title: 'Wer kommt mit?',
    confirmed: (n: number) => `${n} zugesagt`,
    invite: 'Teil den Plan – wer ihn öffnet, kann hier zusagen.',
    you: '(du)',
    rsvp: { yes: 'Zugesagt', maybe: 'Vielleicht', no: 'Nicht dabei' },
    namePlaceholder: 'Dein Name',
    join: 'Dabei',
    imIn: 'Ich bin dabei',
    setMeeting: 'Treffpunkt festlegen',
    vote: 'Worauf habt ihr Lust?',
    voteOptions: {
      activity: 'Aktivität',
      gaming: 'Gaming',
      cinema: 'Kino',
      bar: 'Bar',
      food: 'Essen',
      nature: 'Draußen',
    },
  },

  tour: {
    start: 'Tour starten',
    next: (label: string, name: string) => `Weiter: ${label} · ${name}`,
    breakLabel: 'Pause',
    finish: 'Tour beenden',
    adjustTitle: 'Tour anpassen',
    tweaks: {
      'less-walk': 'Weniger laufen',
      museum: 'Mehr Museen',
      photo: 'Mehr Fotospots',
      free: 'Nur kostenlos',
      calm: 'Entspannter',
    },
    rainTitle: 'Es soll regnen.',
    rainHint: 'Ich kann die Stationen unter freiem Himmel gegen etwas Überdachtes tauschen.',
    adjust: 'Tour anpassen',
    sources: 'Orte und Öffnungszeiten: OpenStreetMap. Bilder und Beschreibungen: Wikipedia. Gehzeiten sind geschätzt.',
    stay: (duration: string) => `${duration} Aufenthalt`,
    navigate: 'Hinführen',
    source: 'Quelle: Wikipedia',
    openUntil: (time: string) => `Geöffnet bis ${time}`,
    openMidnight: 'Geöffnet bis Mitternacht',
    open24: 'Rund um die Uhr geöffnet',
    closedThen: 'Zu dieser Zeit geschlossen',
    travel: (duration: string, mode: string, distance: string, approx: boolean) =>
      `${approx ? 'ca. ' : ''}${duration} ${mode} · ${distance}`,
    stationsAria: (n: number) => `${n} Stationen`,
    tweakFailed: 'Dafür finde ich hier gerade keine Tour.',
    replaceFailed: 'Hier in der Nähe gibt es gerade keine passende Alternative.',
  },

  discover: {
    title: 'Sehenswürdigkeiten',
    question: 'Was möchtest du sehen?',
    around: (place: string) => `Rund um ${place}`,
    aroundYou: 'Rund um deinen Standort',
    chooseLocation: 'Ort wählen',
    change: '· ändern',
    durationAria: 'Wie viel Zeit habt ihr?',
    durations: { 120: '1–2 Std.', 210: '3–4 Std.', 300: 'Halber Tag', 480: 'Ganzer Tag' },
    options: {
      wahrzeichen: { title: 'Wahrzeichen', hint: 'Die Orte, für die man herkommt' },
      kultur: { title: 'Kunst & Kultur', hint: 'Museen, Galerien und Geschichte' },
      parks: { title: 'Parks & besondere Orte', hint: 'Grün, Aussicht und Ruhe' },
      fotos: { title: 'Fotospots', hint: 'Die schönsten Motive der Umgebung' },
      ueberraschung: { title: 'Überrasch mich', hint: 'Eine bunte Mischung, jedes Mal anders' },
    },
    footer: (start: string | null, home: string | null) =>
      `Die Tour beginnt ${start ? `um ${start} Uhr` : 'jetzt'} an deinem Standort und läuft zu Fuß. Öffnungszeiten, Wetter und Tageslicht sind eingerechnet${home ? `, der Rückweg bis ${home} Uhr auch` : ''}.`,
  },

  plans: {
    title: 'Deine Pläne',
    empty: 'Noch nichts geplant.',
    emptyHint: 'Sobald du einen Plan startest, taucht er hier auf.',
    cta: 'Jetzt los',
    footer: 'Die Liste liegt nur in diesem Browser. Geteilte Pläne verfallen nach sieben Tagen.',
  },

  profile: {
    title: 'Profil',
    preferences: 'Vorlieben',
    liked: 'Mag ich',
    disliked: 'Lieber nicht',
    noData: 'Noch nichts gelernt. Das kommt mit der Nutzung.',
    language: 'Sprache',
    privacy: 'Daten & Datenschutz',
    savedPlace: 'Gespeicherter Ort',
    none: 'keiner',
    locationSource: 'Standortquelle',
    sourceDevice: 'Gerätestandort',
    sourceManual: 'manuell gewählt',
    rememberedPlaces: 'Gemerkte Orte',
    priceSensitivity: 'Preis-Empfindlichkeit',
    distanceSensitivity: 'Entfernungs-Empfindlichkeit',
    privacyText:
      'Alles wird nur in diesem Browser gespeichert. Es gibt kein Konto, keinen Server-Abgleich und keine Weitergabe an Dritte. Dein Standort wird nur für die aktuelle Suche verwendet.',
    clear: 'Alle Daten löschen',
    cleared: 'Gelöscht.',
  },

  notFound: {
    title: 'Diesen Plan gibt es nicht mehr.',
    text: 'Geteilte Pläne laufen nach einer Weile ab. Erstell dir in ein paar Sekunden einen neuen.',
    cta: 'Neuen Plan machen',
  },

  /** Fehlercodes der Schnittstelle → Text. */
  errors: {
    'no-plan': 'Dafür finde ich gerade nichts Passendes.',
    'no-sights': 'Hier finde ich gerade zu wenige offene Sehenswürdigkeiten für eine Tour.',
    'sights-unavailable':
      'Die Sehenswürdigkeiten konnten gerade nicht geladen werden. Versuch es in ein paar Sekunden nochmal.',
    'window-too-short': (time: string) =>
      `Bis ${time} Uhr zuhause ist zu knapp – mit Hin- und Rückweg passt nichts Sinnvolles mehr hinein.`,
    'short-window': (duration: string) =>
      `In ${duration} finde ich gerade nichts, das offen und schnell genug erreichbar ist.`,
    'no-alternative': 'Dafür finde ich gerade keine Alternative.',
    'no-fit': 'Zu dieser Zeit passt von diesem Plan nichts mehr – erstell lieber einen neuen.',
    'location-missing': 'Standort fehlt.',
    'location-invalid': 'Standort ist ungültig.',
    'not-found': 'Diesen Plan gibt es nicht mehr.',
    offline: 'Keine Verbindung. Versuch es gleich nochmal.',
    interrupted: 'Die Planung wurde unterbrochen.',
    failed: 'Die Planung ist fehlgeschlagen. Versuch es gleich nochmal.',
  },

  /** Plantitel – vom Server als Schlüssel geliefert. */
  titles: {
    plan: (party: Party, dayPart: DayPart) =>
      `${party === 'solo' ? 'Dein' : 'Euer'} ${{ morning: 'Vormittag', midday: 'Mittag', afternoon: 'Nachmittag', evening: 'Abend', night: 'Nacht' }[dayPart]}`,
    tour: (place: string | null) => (place ? `${place} entdecken` : 'Deine Umgebung entdecken'),
  },

  /** Warum eine Station im Plan ist. */
  reasons: {
    wetIndoor: 'Drinnen – passt zum Regen.',
    niceOutdoor: 'Draußen – das Wetter spielt mit.',
    hot: 'Angenehm bei der Wärme.',
    cold: 'Warm und trocken.',
    date: 'Ruhig genug für zu zweit.',
    action: 'Da ist was los.',
    family: 'Funktioniert mit Kindern gut.',
    free: 'Kostet nichts.',
    cheap: 'Günstig und nah.',
    novelty: 'Mal etwas anderes.',
    near: 'Gleich um die Ecke.',
    fits: 'Passt zur Uhrzeit und ist offen.',
    catFood: 'Gute Zeit für etwas zu essen.',
    catCafe: 'Gute Stelle für eine Pause.',
    catBar: 'Guter Ausklang.',
    catActivity: 'Da kommt keine Langeweile auf.',
    catCinema: 'Ihr müsst euch um nichts kümmern.',
    catCulture: 'Etwas fürs Auge.',
    catNature: 'Einmal raus und durchatmen.',
    catSport: 'Bringt euch in Bewegung.',
    catWellness: 'Zum Runterkommen.',
    catShopping: 'Zum Stöbern und Treibenlassen.',
    catEvent: 'Gibt es nur heute.',
    famous: 'Einer der bekanntesten Orte der Stadt.',
    classic: 'Ein Klassiker der Stadt.',
    hidden: 'Ein Geheimtipp abseits der großen Ziele.',
    memorial: 'Ein Ort zum Innehalten.',
    museum: 'Drinnen gibt es viel zu entdecken.',
    photo: 'Gutes Licht für Fotos.',
    park: 'Zum Durchatmen zwischendurch.',
    fewSteps: 'Nur ein paar Schritte weiter.',
    known: 'Bekannt in der Stadt – und gut erreichbar.',
    onTheWay: 'Liegt gut auf dem Weg.',
    lunch: 'Mittagspause in der Nähe.',
    break: 'Kurze Pause zum Auftanken.',
  },

  /** Hinweise unter dem Plan. */
  notes: {
    weatherAllIndoor: () => 'Alles drinnen – bei dem Wetter die bessere Wahl.',
    weatherIndoorWhenRain: () => 'Wenn es regnet, seid ihr drinnen.',
    weatherPartOutdoor: () => 'Ein Teil ist draußen. Zieht euch was Wasserdichtes an.',
    homeIncluded: () => 'Rückweg ist eingerechnet – ihr seid rechtzeitig zuhause.',
    overBudget: () => 'Im oberen Bereich kann es knapp über eurem Budget liegen.',
    unknownHours: (p: { count: number }) =>
      p.count === 1
        ? 'Für einen Punkt sind keine Öffnungszeiten hinterlegt – vorher kurz prüfen.'
        : `Für ${p.count} Punkte sind keine Öffnungszeiten hinterlegt – vorher kurz prüfen.`,
    droppedSlot: () => 'Für einen weiteren Programmpunkt war gerade nichts Passendes offen.',
    lateStart: (p: { time: string }) =>
      `Um diese Uhrzeit hat noch kaum etwas geöffnet – der Plan beginnt deshalb um ${p.time} Uhr.`,
    tourLateStart: () => 'Um diese Uhrzeit hat noch kaum etwas geöffnet – die Tour beginnt deshalb später.',
    tourRainStart: (p: { time: string }) =>
      `Anfangs regnet es – die Tour beginnt deshalb um ${p.time} Uhr, wenn mehr drinnen offen hat.`,
    tourExtended: () => 'Zu deiner Auswahl gab es hier wenig – ergänzt um weitere Sehenswürdigkeiten.',
    homeByFit: (p: { time: string; fit: number; wanted: number }) =>
      `Bis ${p.time} Uhr zuhause: Dafür passen ${p.fit} ${p.fit === 1 ? 'Station' : 'Stationen'} – ${p.wanted} würden zu spät enden.`,
    retimed: (p: { time: string; replaced: number; dropped: number }) => {
      const teile: string[] = [];
      if (p.replaced > 0) {
        teile.push(
          p.replaced === 1
            ? 'eine Station ist ausgetauscht, weil sie zur neuen Zeit nicht mehr passte'
            : `${p.replaced} Stationen sind ausgetauscht, weil sie zur neuen Zeit nicht mehr passten`,
        );
      }
      if (p.dropped > 0) {
        teile.push(
          p.dropped === 1
            ? 'eine passte gar nicht mehr (geschlossen, dunkel oder zu spät) und ist weggefallen'
            : `${p.dropped} passten gar nicht mehr (geschlossen, dunkel oder zu spät) und sind weggefallen`,
        );
      }
      return teile.length === 0
        ? `Auf ${p.time} Uhr verschoben – alle Stationen passen auch zur neuen Zeit.`
        : `Auf ${p.time} Uhr verschoben – ${teile.join(', ')}.`;
    },
  },

  /** Was aus dem Freitext verstanden wurde. */
  understood: {
    solo: 'alleine unterwegs',
    partner: 'zu zweit',
    family: 'mit Familie',
    friends: 'mit Freunden',
    people: (n: number) => `${n} Personen`,
    free: 'kostenlos',
    budget: (amount: number) => `Budget ${amount} €`,
    cheap: 'günstig',
    budgetAny: 'Budget egal',
    hoursRange: (a: number, b: number) => `${a}–${b} Stunden`,
    hours: (n: number) => `${n} Stunden Zeit`,
    wholeDay: 'ganzer Tag',
    homeBy: (time: string) => `zuhause bis ${time} Uhr`,
    startAt: (time: string) => `Start um ${time} Uhr`,
    short: 'eher kurz',
    romantic: 'romantisch',
    action: 'Action',
    chill: 'entspannt',
    party: 'Party',
    food: 'Essen',
    nature: 'Natur',
    gaming: 'Gaming',
    new: 'etwas Neues',
    cinema: 'Kino',
    cafe: 'Café',
    culture: 'Kultur',
    indoor: 'lieber drinnen',
    near: 'ganz in der Nähe',
    walk: 'zu Fuß',
    bike: 'mit dem Rad',
    car: 'mit dem Auto',
    transit: 'mit Bus & Bahn',
  },

  /** Arten von Orten. Schlüssel ist die interne Bezeichnung aus der Taxonomie. */
  kinds: {
    Aquarium: 'Aquarium',
    Arcade: 'Arcade',
    Asiatisch: 'Asiatisch',
    Aussichtspunkt: 'Aussichtspunkt',
    Bar: 'Bar',
    Biergarten: 'Biergarten',
    Bowling: 'Bowling',
    Brunnen: 'Brunnen',
    Brücke: 'Brücke',
    Burger: 'Burger',
    Bühne: 'Bühne',
    Café: 'Café',
    Club: 'Club',
    'Comedy-Bühne': 'Comedy-Bühne',
    Denkmal: 'Denkmal',
    Dom: 'Dom',
    Einkaufszentrum: 'Einkaufszentrum',
    Eisbahn: 'Eisbahn',
    Eisdiele: 'Eisdiele',
    Erlebnisbad: 'Erlebnisbad',
    'Escape Room': 'Escape Room',
    Event: 'Event',
    Flohmarkt: 'Flohmarkt',
    Freizeitpark: 'Freizeitpark',
    Galerie: 'Galerie',
    Garten: 'Garten',
    Gedenkort: 'Gedenkort',
    'Gehobene Küche': 'Gehobene Küche',
    'Historisches Gebäude': 'Historisches Gebäude',
    Imbiss: 'Imbiss',
    Italienisch: 'Italienisch',
    Karaoke: 'Karaoke',
    Kino: 'Kino',
    Kirche: 'Kirche',
    Kletterhalle: 'Kletterhalle',
    Kunstwerk: 'Kunstwerk',
    'Late-Night-Führung': 'Late-Night-Führung',
    Leuchtturm: 'Leuchtturm',
    Markt: 'Markt',
    Minigolf: 'Minigolf',
    Museum: 'Museum',
    Museumsschiff: 'Museumsschiff',
    Naturgebiet: 'Naturgebiet',
    'Open-Air-Konzert': 'Open-Air-Konzert',
    Palast: 'Palast',
    Park: 'Park',
    Pizza: 'Pizza',
    Pub: 'Pub',
    'Quiz-Abend': 'Quiz-Abend',
    Radtour: 'Radtour',
    Restaurant: 'Restaurant',
    Ruine: 'Ruine',
    Schloss: 'Schloss',
    Schwimmbad: 'Schwimmbad',
    Sehenswürdigkeit: 'Sehenswürdigkeit',
    Spielbank: 'Spielbank',
    Sportzentrum: 'Sportzentrum',
    Stadttor: 'Stadttor',
    Strand: 'Strand',
    Streetfood: 'Streetfood',
    'Streetfood-Festival': 'Streetfood-Festival',
    Tanzen: 'Tanzen',
    Therme: 'Therme',
    Turm: 'Turm',
    'VR-Arena': 'VR-Arena',
    Zoo: 'Zoo',
  } as Record<string, string>,
};

/**
 * Form jeder Sprache. Die Werte sind Strings oder Funktionen mit denselben
 * Parametern – der Inhalt ist frei, die Struktur nicht.
 */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R extends string ? string : R
    : T extends readonly string[]
      ? string[]
      : T extends object
        ? { [K in keyof T]: Widen<T[K]> }
        : T;

export type Dictionary = Widen<typeof de>;
