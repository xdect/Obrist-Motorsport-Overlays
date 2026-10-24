'use strict';
// Einstellungen: liegen als JSON im Benutzer-Datenordner und werden vom Core-Prozess verwaltet.
//
// Aufbau (ab 1.3):
//   layouts:    { <id>: { name, overlays: { relative: {enabled, x, y, scale, opacity, …Optionen}, … } } }
//   gameAssign: { practice: <layoutId>, qualify: <layoutId>, race: <layoutId> }
//   editLayout: <layoutId> | null   – «Positionieren»: dieses Layout jetzt anzeigen, egal welche Session
//   streams:    { <id>: { name, width, height, sessions: {practice, qualify, race}, widgets: { <id>: {type, x, y, scale, opacity, options} } } }
// Löschen per Patch: { layouts: { <id>: null } }
const fs = require('fs');
const path = require('path');
const D = require('../../web/shared/defaults');

const OVERLAYS = D.TYPES;

function defaults() {
  return {
    source: 'auto',      // 'auto' = iRacing, sobald es läuft | 'demo'
    demoSession: 'race', // Session-Art im Demo-Modus: practice | qualify | race
    demoCar: 'car',      // Demo: 'car' = im Auto, 'box' = in der Box
    locked: true,        // gesperrt = Klicks gehen durch zu iRacing
    autostart: false,    // mit Windows starten (im Hintergrund)
    autoUpdate: true,    // automatisch nach Updates suchen
    backgroundHintShown: false,
    port: 7913,
    driverName: 'Mischa Obrist',
    carNumber: '13',
    editLayout: null,
  };
}

// Beispiel für den ersten Start: 2560×1440 (OBS-Leinwand), Elemente leicht vergrössert
function defaultStream() {
  const s = D.streamLayout('Stream');
  const w = (type, x, y) => Object.assign(D.widget(type, x, y), { scale: 1.25 });
  s.widgets = {
    w1: w('standings', 32, 32),
    w2: w('delta', 986, 32),
    w3: w('relative', 32, 1033),
    w4: w('inputs', 1990, 1220),
  };
  s.widgets.w1.options.rows = 12;
  return s;
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? deepMerge(out[k], v) : v;
  }
  return out;
}

const clean = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v && typeof v === 'object'));
const num = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };

// Bringt gespeicherte oder gepatchte Daten in die vollständige, gültige Form.
function normalize(input) {
  const data = deepMerge(defaults(), input || {});

  // Layouts (Migration: bis 1.2 gab es nur «overlays»)
  let layouts = clean(data.layouts);
  if (!Object.keys(layouts).length) {
    layouts = { standard: data.overlays ? { name: 'Standard', overlays: data.overlays } : D.gameLayout('Standard') };
  }
  for (const [id, l] of Object.entries(layouts)) {
    const overlays = {};
    for (const t of Object.keys(D.TYPES)) {
      overlays[t] = { ...D.overlayDefaults(t, false), ...((l.overlays || {})[t] || {}) };
    }
    layouts[id] = { name: String(l.name || 'Layout').slice(0, 40), overlays };
  }
  data.layouts = layouts;
  delete data.overlays;

  const ids = Object.keys(layouts);
  const ga = data.gameAssign || {};
  data.gameAssign = {};
  for (const k of Object.keys(D.SESSIONS)) data.gameAssign[k] = layouts[ga[k]] ? ga[k] : ids[0];
  if (data.editLayout && !layouts[data.editLayout]) data.editLayout = null;
  if (!D.SESSIONS[data.demoSession]) data.demoSession = 'race';
  if (data.demoCar !== 'box') data.demoCar = 'car';
  data.theme = D.normalizeTheme(data.theme);

  // Stream-Overlays (beim ersten Start ein Beispiel anlegen; leer bleibt leer)
  const streams = data.streams === undefined ? { s1: defaultStream() } : clean(data.streams);
  for (const [id, s] of Object.entries(streams)) {
    const base = D.streamLayout();
    const widgets = {};
    for (const [wid, w] of Object.entries(clean(s.widgets))) {
      if (!D.TYPES[w.type]) continue;
      const d = D.widget(w.type);
      widgets[wid] = {
        type: w.type,
        x: Math.round(num(w.x, d.x, -2000, 8000)),
        y: Math.round(num(w.y, d.y, -2000, 8000)),
        scale: num(w.scale, 1, 0.3, 4),
        opacity: num(w.opacity, 0.92, 0.1, 1),
        options: { ...d.options, ...(w.options || {}) },
      };
    }
    streams[id] = {
      name: String(s.name || base.name).slice(0, 40),
      width: Math.round(num(s.width, base.width, 320, 7680)),
      height: Math.round(num(s.height, base.height, 240, 4320)),
      sessions: { ...base.sessions, ...(s.sessions || {}) },
      widgets,
    };
  }
  data.streams = streams;
  return data;
}

class Settings {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'settings.json');
    this.listeners = new Set();
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* erste Ausführung */ }
    this.data = normalize(stored);
    this._timer = null;
  }
  get() { return this.data; }
  update(patch) {
    this.data = normalize(deepMerge(this.data, patch));
    this._saveSoon();
    for (const fn of this.listeners) fn(this.data, patch);
    return this.data;
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _saveSoon() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
      } catch (e) { console.error('[settings] speichern fehlgeschlagen:', e.message); }
    }, 300);
  }
}

// Welches Spiel-Layout ist gerade dran?
function activeLayout(settings, category) {
  if (settings.editLayout && settings.layouts[settings.editLayout]) return settings.editLayout;
  const id = settings.gameAssign[category || 'race'];
  return settings.layouts[id] ? id : Object.keys(settings.layouts)[0];
}

module.exports = { Settings, OVERLAYS, defaults, deepMerge, normalize, activeLayout };
