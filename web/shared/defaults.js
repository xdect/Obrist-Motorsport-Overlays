// Gemeinsame Grundwerte für Core (Node) und Oberfläche (Browser).
// Ein «Overlay» ist ein Anzeige-Element (Relative, Fuel …). Ein «Layout» fasst alle Overlays für
// das Spiel zusammen; ein «Stream-Overlay» ist eine Leinwand in Stream-Grösse mit platzierten Elementen.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OMDefaults = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TYPES = {
    relative:  { title: 'Relative',  w: 430, h: 300 },
    standings: { title: 'Standings', w: 540, h: 620 },
    fuel:      { title: 'Fuel',      w: 330, h: 230 },
    inputs:    { title: 'Inputs',    w: 430, h: 150 },
    delta:     { title: 'Delta',     w: 470, h: 96  },
    trackmap:  { title: 'Trackmap',  w: 400, h: 300, sizable: true }, // Breite/Höhe frei einstellbar
    flags:     { title: 'Flaggen',   w: 380, h: 92 },
    digiflag:  { title: 'Digiflag',  w: 220, h: 220 },
    timer:     { title: 'Session-Timer', w: 320, h: 84 },
    datablock: { title: 'Datenblock', w: 270, h: 64 },
    pithelper: { title: 'Boxenplatz-Hilfe', w: 230, h: 340 },
    gmeter:    { title: 'G-Kraft', w: 300, h: 300 },
    // Nur im Stream: füllt die ganze Leinwand
    cover:     { title: 'Garagen-Cover', w: 1920, h: 1080, streamOnly: true },
  };
  // Für Fuel ist der Spritrechner breiter geworden
  TYPES.fuel.w = 560; TYPES.fuel.h = 214;

  // Optionen je Overlay-Typ (gelten im Spiel und im Stream)
  // show: wann sichtbar – 'both' (im Auto und in der Box), 'car' (nur im Auto), 'box' (nur Box/Garage/Replay)
  const OPTIONS = {
    relative:  { show: 'both', carsAhead: 4, carsBehind: 4, showIRating: true },
    standings: { show: 'both', rows: 16, classFilter: 'mine' },          // 'mine' | 'all'
    fuel:      { show: 'both', marginLaps: 0.5, avgLaps: 5 },            // Reserve in Runden, Durchschnitt über N Runden
    inputs:    { show: 'both', traceSeconds: 6 },
    delta:     { show: 'both', reference: 'best' },                      // 'best' | 'session'
    // carLabel: 'pos' (Position) | 'num' (Startnummer) | 'none'
    trackmap:  {
      show: 'both', demoClasses: 'multi',
      width: 400, height: 300, padding: 16,                                                   // Grösse
      showBg: false, showHeader: false, mapOpacity: 1, shadow: true,                          // Erscheinungsbild
      trackWidth: 9, trackColor: '#141518', showStartFinish: true, showDirection: true,       // Strecke
      ringShow: true, ringColor: '#CDCDD2', ringWidth: 1.3, ringOpacity: 0.42, ringGlow: false, // Rand
      showTurns: true, turnSize: 1, turnColor: '#A9A8A3', turnBg: true,                       // Kurven
      showSectors: true, sectorColor: '', sectorWidth: 2.4, sectorHighlight: false,            // Sektoren ('' = Akzentfarbe)
      carSize: 1, carLabel: 'pos', classColors: true, carColor: '#E9E7E1', carOutline: true, pitCars: 'dim', // Fahrzeuge
      leaderShow: true, leaderIcon: 'crown', leaderPerClass: true, leaderColor: '',          // Führender
      playerColor: '', playerSize: 1.25, playerLabel: 'same', playerGlow: true, playerPulse: false, // ich
      refShow: false, refColor: '#4CC38A', refStyle: 'ring',                                  // Geist der Bestrunde
      friends: '', friendColor: '#3DA5FF', friendStyle: 'ring',                               // Freunde
      nameLabels: 'off', nameNear: 2, nameFormat: 'short', nameSize: 1,                       // Fahrer-Label
      postPitShow: true, postPitSeconds: 30, postPitColor: '#A06CFF',                         // nach dem Stopp
      longScale: true, longFrom: 10, longFactor: 0.7,                                         // lange Strecken
      showWind: false, windPos: 'tr', windSize: 1, windUnit: 'kmh',                           // Wind
      rotate: 0, mirror: false, align: 'center',                                              // Ausrichtung
    },
    flags:     { show: 'both' },
    digiflag:  { show: 'both', showGreen: true },
    timer:     { show: 'both', mode: 'auto' },                           // 'auto' | 'time' | 'laps'
    datablock: { show: 'both', metric: 'lapCurrent', showLabel: true },
    pithelper: { show: 'car', onlyPitLane: true },
    gmeter:    { show: 'both', maxG: 3 },
    cover:     { trigger: 'garage', image: '' },                         // 'garage' | 'box'
  };
  // Werte für den Datenblock
  const METRICS = {
    lapCurrent: 'Aktuelle Runde', lapLast: 'Letzte Runde', lapBest: 'Beste Runde', deltaBest: 'Delta zur Bestzeit',
    speed: 'Tempo', gear: 'Gang', rpm: 'Drehzahl', fuel: 'Sprit', position: 'Position', lap: 'Runde',
    lapsRemain: 'Runden übrig', timeRemain: 'Restzeit', airTemp: 'Lufttemperatur', trackTemp: 'Streckentemperatur',
    incidents: 'Incidents', clock: 'Uhrzeit',
  };
  const SHOW = { both: 'Im Auto und in der Box', car: 'Nur im Auto', box: 'Nur in der Box / Replay' };

  // Grundgrösse eines Elements in px (vor dem Zoom); bei «sizable» aus den Optionen
  function baseSize(type, o) {
    const t = TYPES[type] || { w: 300, h: 200 };
    if (t.sizable && o) {
      const w = Number(o.width), h = Number(o.height);
      return [w >= 60 ? Math.round(w) : t.w, h >= 60 ? Math.round(h) : t.h];
    }
    return [t.w, t.h];
  }
  // Session-Filter je Element (inPractice / inQualify / inRace; fehlt = an)
  const SESSION_KEY = { practice: 'inPractice', qualify: 'inQualify', race: 'inRace' };
  function sessionAllows(o, category) {
    const k = SESSION_KEY[category];
    return !k || !o || o[k] !== false;
  }

  // Ist ein Element bei diesem Zustand sichtbar? inCar: true | false | null (unbekannt)
  function showFor(show, inCar) {
    if (!show || show === 'both' || inCar === null || inCar === undefined) return true;
    return (show === 'car') === inCar;
  }

  // ---------- Farben ----------
  const THEME = { accent: '#C8A24C', panel: '#16171A', text: '#F2F0EA', gain: '#4CC38A', loss: '#E0463A' };
  const PRESETS = [
    { name: 'OM Gold',  accent: '#C8A24C' },
    { name: 'Rennrot',  accent: '#D7263D' },
    { name: 'Papaya',   accent: '#FF8000' },
    { name: 'Petrol',   accent: '#1FA5A0' },
    { name: 'Eisblau',  accent: '#4DA3FF' },
    { name: 'Violett',  accent: '#8E6CEF' },
    { name: 'Silber',   accent: '#C9CDD2' },
    { name: 'Hell',     accent: '#C8A24C', panel: '#F4F3EF', text: '#16171A', gain: '#1E9E62', loss: '#C9332A' },
  ];
  const HEX = /^#[0-9a-f]{6}$/i;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
  function luminance(h) {
    const c = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  // Schrift auf einer Farbfläche: dunkel oder weiss, je nachdem was mehr Kontrast hat
  function onColor(h) {
    const L = luminance(h);
    return (L + 0.05) / (luminance('#16171A') + 0.05) >= 1.05 / (L + 0.05) ? '#16171A' : '#FFFFFF';
  }
  function normalizeTheme(t) {
    const out = {};
    for (const k of Object.keys(THEME)) out[k] = (t && HEX.test(t[k])) ? t[k].toUpperCase() : THEME[k];
    return out;
  }
  // CSS-Variablen für Overlays und Hauptfenster
  function themeVars(theme) {
    const t = normalizeTheme(theme);
    const darkPanel = luminance(t.panel) < 0.4;
    return {
      '--gold': t.accent,
      '--accent-rgb': rgb(t.accent).join(', '),
      '--gold-pale': mix(t.accent, darkPanel ? '#FFFFFF' : '#000000', 0.35),
      '--on-accent': onColor(t.accent),
      '--carbon': rgb(t.panel).join(', '),
      '--graphite': mix(t.panel, t.text, 0.1),
      '--rule': mix(t.panel, t.text, 0.08),
      '--chalk': t.text,
      '--mist': mix(t.text, t.panel, 0.4),
      '--gain': t.gain,
      '--loss': t.loss,
    };
  }
  function applyTheme(theme, el) {
    const vars = themeVars(theme);
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  }

  // Startpositionen im Spiel (werden vom Programm an den Bildschirm angepasst)
  const GAME_POS = {
    relative: [60, 700], standings: [60, 60], fuel: [1900, 60],
    inputs: [1900, 1150], delta: [2330, 60], trackmap: [1900, 320],
    flags: [1100, 200], digiflag: [1500, 200], timer: [1100, 60], datablock: [1100, 320],
    pithelper: [700, 400], gmeter: [700, 760],
  };

  const SESSIONS = { practice: 'Training', qualify: 'Qualifying', race: 'Rennen' };

  function overlayDefaults(type, enabled) {
    const p = GAME_POS[type] || [100, 100];
    return Object.assign({ enabled: !!enabled, scale: 1, opacity: 0.92, x: p[0], y: p[1] }, OPTIONS[type]);
  }

  const gameTypes = () => Object.keys(TYPES).filter((t) => !TYPES[t].streamOnly);

  function gameLayout(name, enabledTypes) {
    const on = enabledTypes || ['relative', 'fuel', 'delta'];
    const overlays = {};
    for (const t of gameTypes()) overlays[t] = overlayDefaults(t, on.includes(t));
    return { name: name || 'Neues Layout', overlays };
  }

  function widget(type, x, y) {
    return { type, x: x || 40, y: y || 40, scale: 1, opacity: 0.92, options: Object.assign({}, OPTIONS[type]) };
  }

  function streamLayout(name) {
    return {
      name: name || 'Neues Stream-Overlay',
      width: 2560, height: 1440,
      sessions: { practice: true, qualify: true, race: true },
      widgets: {},
    };
  }

  // Session-Art aus dem iRacing-Sessiontyp («Practice», «Lone Qualify», «Race» …)
  function sessionCategory(type) {
    const t = String(type || '').toLowerCase();
    if (!t) return null;
    if (t.includes('qualif')) return 'qualify';
    if (t.includes('race') || t.includes('heat') || t.includes('feature')) return 'race';
    return 'practice'; // Practice, Open Practice, Warmup, Offline Testing, Time Trial …
  }

  function newId(prefix) {
    return (prefix || 'x') + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }

  return { TYPES, OPTIONS, METRICS, GAME_POS, gameTypes, SESSIONS, SHOW, showFor, baseSize, sessionAllows, THEME, PRESETS, normalizeTheme, themeVars, applyTheme, onColor,
    overlayDefaults, gameLayout, widget, streamLayout, sessionCategory, newId };
});
