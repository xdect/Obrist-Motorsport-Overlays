'use strict';
// Einstellungen: liegen als JSON im Benutzer-Datenordner und werden vom Core-Prozess verwaltet.
const fs = require('fs');
const path = require('path');

const OVERLAYS = {
  relative:  { title: 'Relative',  w: 430, h: 300, x: 60,   y: 700 },
  standings: { title: 'Standings', w: 540, h: 620, x: 60,   y: 60  },
  fuel:      { title: 'Fuel',      w: 330, h: 230, x: 1900, y: 60  },
  inputs:    { title: 'Inputs',    w: 430, h: 150, x: 1900, y: 1150 },
  delta:     { title: 'Delta',     w: 470, h: 96,  x: 2330, y: 60  },
  trackmap:  { title: 'Trackmap',  w: 330, h: 330, x: 1900, y: 320 },
};

function defaults() {
  const overlays = {};
  for (const [id, o] of Object.entries(OVERLAYS)) {
    overlays[id] = { enabled: id === 'relative' || id === 'fuel' || id === 'delta', scale: 1, opacity: 0.92, x: o.x, y: o.y };
  }
  overlays.relative.carsAhead = 4;
  overlays.relative.carsBehind = 4;
  overlays.relative.showIRating = true;
  overlays.standings.rows = 16;
  overlays.standings.classFilter = 'mine';   // 'mine' | 'all'
  overlays.fuel.marginLaps = 0.5;            // Sicherheitsreserve in Runden
  overlays.fuel.avgLaps = 5;                 // Durchschnitt über die letzten N Runden
  overlays.delta.reference = 'best';         // 'best' | 'session'
  overlays.inputs.traceSeconds = 6;
  overlays.trackmap.showNumbers = true;
  overlays.trackmap.rotate = 0;              // Grad
  overlays.trackmap.mirror = false;          // falls die aufgezeichnete Karte gespiegelt ist
  return {
    source: 'auto',      // 'auto' = iRacing, sobald es läuft | 'demo'
    locked: true,        // gesperrt = Klicks gehen durch zu iRacing
    autostart: false,    // mit Windows starten (im Hintergrund)
    autoUpdate: true,    // automatisch nach Updates suchen
    backgroundHintShown: false,
    port: 7913,
    driverName: 'Mischa Obrist',
    carNumber: '13',
    overlays,
  };
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? deepMerge(out[k], v) : v;
  }
  return out;
}

class Settings {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'settings.json');
    this.listeners = new Set();
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* erste Ausführung */ }
    this.data = deepMerge(defaults(), stored);
    this._timer = null;
  }
  get() { return this.data; }
  update(patch) {
    this.data = deepMerge(this.data, patch);
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

module.exports = { Settings, OVERLAYS, defaults, deepMerge };
