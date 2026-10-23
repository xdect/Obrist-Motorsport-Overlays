'use strict';
// Zeichnet die Streckenform aus deiner eigenen Fahrt auf (iRacing liefert keine Streckenkarte).
// Integriert Geschwindigkeit + Gierwinkel über eine saubere Runde und speichert das Ergebnis
// pro Strecke. Ab der zweiten Session auf derselben Strecke ist die Karte sofort da.
const fs = require('fs');
const path = require('path');

const BINS = 500;

class TrackRecorder {
  constructor(dir) {
    this.dir = path.join(dir, 'tracks');
    this.trackKey = null;
    this.path = null;       // fertige Karte [[x,y], ...] mit BINS Punkten
    this.listeners = new Set();
    this._resetRun();
  }

  onPath(fn) { this.listeners.add(fn); }
  _emit() { for (const fn of this.listeners) fn(this.path); }

  setTrack(id, config) {
    const key = `${id}-${String(config || '').replace(/[^\w-]+/g, '_')}`;
    if (key === this.trackKey) return;
    this.trackKey = key;
    this.path = null;
    this._resetRun();
    try {
      const data = JSON.parse(fs.readFileSync(path.join(this.dir, key + '.json'), 'utf8'));
      if (Array.isArray(data.path) && data.path.length === BINS) this.path = data.path;
    } catch { /* noch nicht aufgezeichnet */ }
    this._emit();
  }

  setStatic(points) { // Demo: fertige Karte übernehmen
    if (this.path === points) return;
    this.path = points;
    this.trackKey = 'static';
    this._emit();
  }

  get recording() { return !this.path; }
  get progress() { return this.bins ? this.bins.filter(Boolean).length / BINS : 0; }

  _resetRun() {
    this.bins = new Array(BINS).fill(null);
    this.x = 0; this.y = 0;
    this.lastPct = null;
    this.lastT = null;
    this.armed = false;
  }

  // car: raw.car, t: Sekunden (SessionTime)
  sample(car, t) {
    if (this.path || !this.trackKey) return;
    if (!car.onTrack || car.onPit) { this._resetRun(); return; }
    const pct = car.lapDistPct;
    if (this.lastT !== null && t === this.lastT) return; // derselbe Telemetrie-Tick
    if (this.lastT !== null) {
      const dt = t - this.lastT;
      if (dt <= 0 || dt > 0.5) { this._resetRun(); }
      else {
        // Fahrzeug-Geschwindigkeit in Weltkoordinaten drehen
        const c = Math.cos(car.yaw), s = Math.sin(car.yaw);
        this.x += (car.vx * c - car.vy * s) * dt;
        this.y += (car.vx * s + car.vy * c) * dt;
      }
    }
    // Aufzeichnung beginnt bei Start/Ziel
    if (this.lastPct !== null && this.lastPct > 0.9 && pct < 0.1) {
      if (this.armed && this.progress > 0.97) { this._finish(); return; }
      this.bins = new Array(BINS).fill(null);
      this.x = 0; this.y = 0;
      this.armed = true;
    }
    if (this.armed) {
      const b = Math.min(BINS - 1, Math.floor(pct * BINS));
      if (!this.bins[b]) this.bins[b] = [this.x, this.y];
    }
    this.lastPct = pct;
    this.lastT = t;
  }

  _finish() {
    // Lücken interpolieren, Drift (Start ≠ Ende) linear über die Runde verteilen
    const b = this.bins;
    for (let i = 0; i < BINS; i++) {
      if (b[i]) continue;
      let p = i - 1; while (p >= 0 && !b[p]) p--;
      let n = i + 1; while (n < BINS && !b[n]) n++;
      if (p < 0 || n >= BINS) { b[i] = b[p < 0 ? n : p] ? [...b[p < 0 ? n : p]] : [0, 0]; continue; }
      const u = (i - p) / (n - p);
      b[i] = [b[p][0] + (b[n][0] - b[p][0]) * u, b[p][1] + (b[n][1] - b[p][1]) * u];
    }
    const endX = this.x, endY = this.y; // sollte ~ (0,0) sein
    const out = b.map(([x, y], i) => [x - endX * (i / BINS), y - endY * (i / BINS)]);
    this.path = out;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, this.trackKey + '.json'), JSON.stringify({ path: out, recorded: new Date().toISOString() }));
    } catch (e) { console.error('[track] speichern fehlgeschlagen:', e.message); }
    this._emit();
  }

  clear() {
    if (this.trackKey) {
      try { fs.unlinkSync(path.join(this.dir, this.trackKey + '.json')); } catch { /* nichts */ }
    }
    this.path = null;
    this._resetRun();
    this._emit();
  }
}

module.exports = { TrackRecorder, BINS };
