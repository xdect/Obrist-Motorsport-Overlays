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
    trackmap:  { title: 'Trackmap',  w: 330, h: 330 },
  };

  // Optionen je Overlay-Typ (gelten im Spiel und im Stream)
  const OPTIONS = {
    relative:  { carsAhead: 4, carsBehind: 4, showIRating: true },
    standings: { rows: 16, classFilter: 'mine' },          // 'mine' | 'all'
    fuel:      { marginLaps: 0.5, avgLaps: 5 },            // Reserve in Runden, Durchschnitt über N Runden
    inputs:    { traceSeconds: 6 },
    delta:     { reference: 'best' },                      // 'best' | 'session'
    trackmap:  { showNumbers: true, rotate: 0, mirror: false },
  };

  // Startpositionen im Spiel (werden vom Programm an den Bildschirm angepasst)
  const GAME_POS = {
    relative: [60, 700], standings: [60, 60], fuel: [1900, 60],
    inputs: [1900, 1150], delta: [2330, 60], trackmap: [1900, 320],
  };

  const SESSIONS = { practice: 'Training', qualify: 'Qualifying', race: 'Rennen' };

  function overlayDefaults(type, enabled) {
    const p = GAME_POS[type] || [100, 100];
    return Object.assign({ enabled: !!enabled, scale: 1, opacity: 0.92, x: p[0], y: p[1] }, OPTIONS[type]);
  }

  function gameLayout(name, enabledTypes) {
    const on = enabledTypes || ['relative', 'fuel', 'delta'];
    const overlays = {};
    for (const t of Object.keys(TYPES)) overlays[t] = overlayDefaults(t, on.includes(t));
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

  return { TYPES, OPTIONS, GAME_POS, SESSIONS, overlayDefaults, gameLayout, widget, streamLayout, sessionCategory, newId };
});
