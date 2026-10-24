// Einstellungs-Menü je Overlay: aufklappbare Bereiche wie bei RaceLab («Overlay-Steuerung»).
// Jedes Feld hat einen Schlüssel (k), unter dem der Wert in den Overlay-Optionen liegt.
// Feldtypen: range, toggle, seg, select, color, number, text, hotkey, html.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OMSchema = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SESSIONS = [
    { k: 'inPractice', label: 'Im Training zeigen', type: 'toggle', def: true },
    { k: 'inQualify', label: 'Im Qualifying zeigen', type: 'toggle', def: true },
    { k: 'inRace', label: 'Im Rennen zeigen', type: 'toggle', def: true },
  ];
  const SHOW = { k: 'show', label: 'Sichtbar', type: 'select', options: [['both', 'Im Auto und in der Box'], ['car', 'Nur im Auto'], ['box', 'Nur in der Box / Replay']] };
  const visibility = () => ({ id: 'visibility', title: 'Sichtbarkeit', fields: [SHOW, ...SESSIONS] });
  const browser = () => ({ id: 'browser', title: 'Browser', game: true, fields: [{ type: 'html', html: 'browser' }] });
  const keys = () => ({ id: 'keys', title: 'Tasten- & Button-Belegung', game: true, fields: [
    { k: 'hotkey', label: 'Ein-/Ausblenden', type: 'hotkey', hint: 'Feld anklicken und Tastenkombination drücken, z. B. Strg+Umschalt+M. Entf löscht sie. Funktioniert auch mit Stream-Deck-Hotkeys.' },
  ] });

  const TRACKMAP = [
    { id: 'demo', title: 'Demo-Modus', fields: [
      { k: 'demoClasses', label: 'Felder in der Demo', type: 'seg', options: [['multi', 'Multi-Class'], ['single', 'Single-Class']], hint: 'Nur für die Vorschau mit Demo-Daten.' },
    ] },
    { id: 'size', title: 'Grösse', fields: [
      { k: 'width', label: 'Overlay-Breite', type: 'number', min: 120, max: 2400, unit: 'px' },
      { k: 'height', label: 'Höhe', type: 'number', min: 100, max: 2400, unit: 'px' },
      { k: 'padding', label: 'Padding', type: 'number', min: 0, max: 120, unit: 'px' },
      { k: 'scale', label: 'Zoom', type: 'range', min: 0.4, max: 3, step: 0.05, pct: true },
    ] },
    { id: 'look', title: 'Erscheinungsbild', fields: [
      { k: 'showBg', label: 'Hintergrund', type: 'toggle' },
      { k: 'opacity', label: 'Hintergrund-Deckkraft', type: 'range', min: 0.1, max: 1, step: 0.02, pct: true },
      { k: 'showHeader', label: 'Kopfzeile mit Streckenname', type: 'toggle' },
      { k: 'mapOpacity', label: 'Deckkraft der Karte', type: 'range', min: 0.2, max: 1, step: 0.02, pct: true },
      { k: 'shadow', label: 'Schatten', type: 'toggle' },
    ] },
    visibility(),
    { id: 'track', title: 'Strecke', fields: [
      { k: 'trackWidth', label: 'Streckenbreite', type: 'range', min: 3, max: 20, step: 0.5, unit: 'px' },
      { k: 'trackColor', label: 'Streckenfarbe', type: 'color' },
      { k: 'showStartFinish', label: 'Start/Ziel-Linie', type: 'toggle' },
      { k: 'showDirection', label: 'Fahrtrichtungs-Pfeil', type: 'toggle' },
    ] },
    { id: 'ring', title: 'Trackmap-Ring', fields: [
      { k: 'ringShow', label: 'Rand um die Strecke', type: 'toggle' },
      { k: 'ringColor', label: 'Randfarbe', type: 'color' },
      { k: 'ringWidth', label: 'Randbreite', type: 'range', min: 0.5, max: 6, step: 0.1, unit: 'px' },
      { k: 'ringOpacity', label: 'Deckkraft des Rands', type: 'range', min: 0.1, max: 1, step: 0.02, pct: true },
      { k: 'ringGlow', label: 'Leuchten in Akzentfarbe', type: 'toggle' },
    ] },
    { id: 'turns', title: 'Kurven', fields: [
      { k: 'showTurns', label: 'Kurvennummern', type: 'toggle' },
      { k: 'turnSize', label: 'Grösse', type: 'range', min: 0.6, max: 2, step: 0.05, pct: true },
      { k: 'turnColor', label: 'Textfarbe', type: 'color' },
      { k: 'turnBg', label: 'Hintergrund-Plakette', type: 'toggle' },
    ] },
    { id: 'sectors', title: 'Sektoren', fields: [
      { k: 'showSectors', label: 'Sektorgrenzen', type: 'toggle' },
      { k: 'sectorColor', label: 'Farbe', type: 'color', accent: true },
      { k: 'sectorWidth', label: 'Strichstärke', type: 'range', min: 1, max: 6, step: 0.2, unit: 'px' },
      { k: 'sectorHighlight', label: 'Meinen aktuellen Sektor hervorheben', type: 'toggle' },
    ] },
    { id: 'cars', title: 'Fahrzeuge', fields: [
      { k: 'carSize', label: 'Grösse', type: 'range', min: 0.5, max: 2, step: 0.05, pct: true },
      { k: 'carLabel', label: 'Beschriftung', type: 'seg', options: [['pos', 'Position'], ['num', 'Nummer'], ['none', 'Keine']] },
      { k: 'classColors', label: 'Klassenfarben (bei mehreren Klassen)', type: 'toggle' },
      { k: 'carColor', label: 'Farbe bei einer Klasse', type: 'color' },
      { k: 'carOutline', label: 'Dunkler Rand', type: 'toggle' },
      { k: 'pitCars', label: 'Autos in der Box', type: 'seg', options: [['dim', 'Blass'], ['show', 'Normal'], ['hide', 'Aus']] },
    ] },
    { id: 'leader', title: 'Marker für Führenden', fields: [
      { k: 'leaderShow', label: 'Marker zeigen', type: 'toggle' },
      { k: 'leaderIcon', label: 'Symbol', type: 'seg', options: [['crown', 'Krone'], ['star', 'Stern'], ['ring', 'Ring']] },
      { k: 'leaderPerClass', label: 'Je Klasse', type: 'toggle' },
      { k: 'leaderColor', label: 'Farbe', type: 'color', accent: true },
    ] },
    { id: 'player', title: 'Spieler-Marker', fields: [
      { k: 'playerColor', label: 'Farbe', type: 'color', accent: true },
      { k: 'playerSize', label: 'Grösse', type: 'range', min: 0.8, max: 2.5, step: 0.05, pct: true },
      { k: 'playerLabel', label: 'Beschriftung', type: 'seg', options: [['same', 'Wie alle'], ['num', 'Nummer'], ['none', 'Keine']] },
      { k: 'playerGlow', label: 'Lichthof', type: 'toggle' },
      { k: 'playerPulse', label: 'Pulsieren', type: 'toggle' },
    ] },
    { id: 'ref', title: 'Referenz-Marker', fields: [
      { k: 'refShow', label: 'Geist meiner Bestrunde', type: 'toggle', hint: 'Zeigt, wo du mit deiner Bestzeit gerade wärst (aus dem Delta berechnet).' },
      { k: 'refColor', label: 'Farbe', type: 'color' },
      { k: 'refStyle', label: 'Darstellung', type: 'seg', options: [['ring', 'Ring'], ['dot', 'Punkt']] },
    ] },
    { id: 'friends', title: 'Freund-Marker', fields: [
      { k: 'friends', label: 'Freunde', type: 'text', placeholder: 'Namen oder iRacing-IDs, mit Komma getrennt' },
      { k: 'friendColor', label: 'Farbe', type: 'color' },
      { k: 'friendStyle', label: 'Darstellung', type: 'seg', options: [['ring', 'Ring'], ['fill', 'Füllung']] },
    ] },
    { id: 'labels', title: 'Fahrer-Label', fields: [
      { k: 'nameLabels', label: 'Namen zeigen', type: 'select', options: [['off', 'Aus'], ['me', 'Nur bei mir'], ['near', 'Bei mir und meinen Nachbarn'], ['all', 'Bei allen']] },
      { k: 'nameNear', label: 'Nachbarn vor und hinter mir', type: 'range', min: 1, max: 5, step: 1 },
      { k: 'nameFormat', label: 'Format', type: 'seg', options: [['last', 'Nachname'], ['short', 'Kürzel'], ['num', '#Nr.']] },
      { k: 'nameSize', label: 'Schriftgrösse', type: 'range', min: 0.6, max: 1.8, step: 0.05, pct: true },
    ] },
    { id: 'postpit', title: 'Post-Pit-Indikator', fields: [
      { k: 'postPitShow', label: 'Nach dem Boxenstopp markieren', type: 'toggle' },
      { k: 'postPitSeconds', label: 'Dauer', type: 'range', min: 5, max: 120, step: 5, unit: 's' },
      { k: 'postPitColor', label: 'Farbe', type: 'color' },
    ] },
    { id: 'long', title: 'Lange-Strecken-Skalierung', fields: [
      { k: 'longScale', label: 'Autos auf langen Strecken verkleinern', type: 'toggle', hint: 'Nordschleife, Le Mans & Co.: sonst überdecken sich die Punkte.' },
      { k: 'longFrom', label: 'Ab Streckenlänge', type: 'range', min: 5, max: 25, step: 0.5, unit: 'km' },
      { k: 'longFactor', label: 'Faktor', type: 'range', min: 0.4, max: 1, step: 0.05, pct: true },
    ] },
    { id: 'wind', title: 'Wind-Indikator', fields: [
      { k: 'showWind', label: 'Wind anzeigen', type: 'toggle', hint: 'Richtung bezogen auf eine nach Norden ausgerichtete Karte.' },
      { k: 'windPos', label: 'Position', type: 'seg', options: [['tl', 'Oben links'], ['tr', 'Oben rechts'], ['bl', 'Unten links'], ['br', 'Unten rechts']] },
      { k: 'windSize', label: 'Grösse', type: 'range', min: 0.6, max: 2, step: 0.05, pct: true },
      { k: 'windUnit', label: 'Einheit', type: 'seg', options: [['kmh', 'km/h'], ['ms', 'm/s']] },
    ] },
    { id: 'align', title: 'Ausrichtung', fields: [
      { k: 'rotate', label: 'Drehen', type: 'range', min: 0, max: 355, step: 5, unit: '°' },
      { k: 'mirror', label: 'Spiegeln', type: 'toggle' },
      { k: 'align', label: 'Karte ausrichten', type: 'seg', options: [['center', 'Mitte'], ['left', 'Links'], ['right', 'Rechts'], ['top', 'Oben'], ['bottom', 'Unten']] },
    ] },
    browser(),
    keys(),
  ];

  // Standard-Menü für alle anderen Overlays: Grösse, Sichtbarkeit, eigene Optionen, Browser, Tasten
  function generic(type) {
    return [
      { id: 'size', title: 'Grösse & Darstellung', fields: [
        { k: 'scale', label: 'Grösse', type: 'range', min: 0.4, max: 3, step: 0.05, pct: true },
        { k: 'opacity', label: 'Deckkraft', type: 'range', min: 0.3, max: 1, step: 0.02, pct: true },
      ] },
      visibility(),
      { id: 'options', title: 'Einstellungen', fields: [{ type: 'html', html: 'typeOptions' }], open: true },
      browser(),
      keys(),
    ];
  }

  function sections(type) { return type === 'trackmap' ? TRACKMAP : generic(type); }

  return { sections };
});
