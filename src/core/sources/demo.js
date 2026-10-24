'use strict';
// Demo-Datenquelle: simuliert ein GT3-Rennen am Red Bull Ring, damit Overlays ohne iRacing
// gestaltet, positioniert und in OBS eingerichtet werden können.
// Liefert denselben raw-Snapshot wie die iRacing-Quelle.

const TRACK_LEN = 4318; // m
const N = 600;          // Stützpunkte entlang der Strecke

// Stilisierte Streckenform (Kontrollpunkte, geschlossene Kurve)
const CTRL = [
  [0, 0], [2.4, -0.25], [4.6, 0.1], [5.35, 0.8], [5.7, 1.7], [7.4, 3.25], [9.1, 4.45],
  [9.65, 5.1], [9.15, 5.55], [6.6, 4.8], [3.9, 3.9], [3.0, 3.55], [2.75, 2.85], [3.25, 2.15],
  [2.55, 1.55], [1.4, 1.95], [0.35, 2.3], [-0.65, 1.95], [-0.85, 1.1], [-0.55, 0.35],
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

function buildTrack() {
  // 1) dicht abtasten
  const dense = [];
  const n = CTRL.length;
  for (let i = 0; i < n; i++) {
    const p0 = CTRL[(i - 1 + n) % n], p1 = CTRL[i], p2 = CTRL[(i + 1) % n], p3 = CTRL[(i + 2) % n];
    for (let k = 0; k < 60; k++) dense.push(catmull(p0, p1, p2, p3, k / 60));
  }
  // 2) gleichmässig nach Bogenlänge neu abtasten
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1];
  const pts = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = (i / N) * total;
    while (cum[j + 1] < s) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length];
    const u = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  const scale = TRACK_LEN / total;
  const ds = TRACK_LEN / N;

  // 3) Krümmung (vorzeichenbehaftet)
  const kappa = pts.map((p, i) => {
    const a = pts[(i - 3 + N) % N], c = pts[(i + 3) % N];
    const h1 = Math.atan2(p[1] - a[1], p[0] - a[0]);
    const h2 = Math.atan2(c[1] - p[1], c[0] - p[0]);
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d / (6 * ds);
  });
  // glätten
  const k = kappa.map((_, i) => {
    let s = 0;
    for (let o = -4; o <= 4; o++) s += kappa[(i + o + N) % N];
    return s / 9;
  });

  // 4) Geschwindigkeitsprofil (Querbeschl., Bremsen rückwärts, Beschleunigen vorwärts)
  const VMAX = 72, ALAT = 7, DEC = 13;
  const v = k.map((x) => Math.min(VMAX, Math.sqrt(ALAT / Math.max(Math.abs(x), 1e-4))));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 2 * N - 1; i >= 0; i--) { // Bremspunkte
      const a = i % N, b = (i + 1) % N;
      v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * DEC * ds));
    }
    for (let i = 0; i < 2 * N; i++) { // Beschleunigung
      const a = i % N, b = (i + 1) % N;
      const acc = Math.max(1.0, 6.5 * (1 - v[a] / 82));
      v[b] = Math.min(v[b], Math.sqrt(v[a] * v[a] + 2 * acc * ds));
    }
  }
  // 5) Zeitprofil: normierte kumulierte Zeit T(pct)
  const tcum = [0];
  for (let i = 0; i < N; i++) tcum.push(tcum[i] + ds / ((v[i] + v[(i + 1) % N]) / 2));
  const lapTime = tcum[N];
  const T = tcum.map((t) => t / lapTime);
  return { pts: pts.map(([x, y]) => [x * scale, y * scale]), k, v, T, lapTime, ds };
}

const NAMES = ['Luca Brenner', 'Jonas Keller', 'Tobias Wirth', 'Marco Rinaldi', 'Sven Lindqvist', 'Daniel Haug',
  'Felix Morand', 'Nico Varga', 'Elias Kuhn', 'Aaron Pike', 'Mathis Roux', 'Jan Novak', 'Leon Strasser',
  'Oskar Berg', 'Fabio Conti', 'Henrik Dahl', 'Ruben Alves', 'Kai Sommer', 'Pierre Lacroix', 'Timo Rautio', 'Lars Eklund'];
const CARS = ['Porsche 911 GT3 R (992)', 'BMW M4 GT3', 'Mercedes-AMG GT3', 'Audi R8 GT3 Evo II', 'Ferrari 296 GT3',
  'McLaren 720S GT3 Evo', 'Lamborghini Huracán GT3 EVO'];

function rng(seed) { // deterministisch, damit die Demo immer gleich startet
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

class DemoSource {
  constructor(opts = {}) {
    this.track = buildTrack();
    this.rand = rng(13);
    this.playerName = opts.driverName || 'Mischa Obrist';
    this.playerNumber = opts.carNumber || '13';
    this.reset();
  }

  reset() {
    const r = this.rand;
    const base = this.track.lapTime;
    this.sessionTime = 0;
    this.timeRemain = 40 * 60 + 12;
    this.fuelMax = 120;
    this.fuel = 61.4;
    this.burn = 2.86;
    const used = new Set(['13']);
    this.cars = [];
    const total = 22, playerIdx = 4;
    for (let i = 0; i < total; i++) {
      const isMe = i === playerIdx;
      let num;
      do { num = String(2 + Math.floor(r() * 97)); } while (used.has(num));
      used.add(num);
      const pace = isMe ? 1.0035 : 1 + i * 0.0011 + (r() - 0.5) * 0.004;
      this.cars.push({
        idx: i,
        name: isMe ? this.playerName : NAMES[i > playerIdx ? i - 1 : i],
        number: isMe ? this.playerNumber : num,
        carName: isMe ? 'Porsche 911 GT3 R (992)' : CARS[Math.floor(r() * CARS.length)],
        iRating: isMe ? 3124 : Math.round(1700 + r() * 3600),
        license: isMe ? 'A' : (r() > 0.8 ? 'P' : r() > 0.3 ? 'A' : 'B'),
        safety: isMe ? '4.21' : (1.5 + r() * 3.4).toFixed(2),
        lapTime: base * pace,
        // Fortschritt in Runden (ganzzahliger Teil = abgeschlossene Runden), normiert in Zeit τ
        progress: 12 + (1 - i * 0.034 - r() * 0.012),
        thisLapFactor: 1,
        lastLap: -1,
        bestLap: -1,
        pitTimer: 0,
        lapStartSession: 0,
      });
    }
    this.playerIdx = playerIdx;
    // Startwerte für Rundenzeiten
    for (const c of this.cars) {
      c.lastLap = c.lapTime * (1 + (this.rand() - 0.3) * 0.006);
      c.bestLap = c.lapTime * (1 - this.rand() * 0.003);
      c.lapStartSession = -(c.progress % 1) * c.lapTime;
    }
  }

  _pctToTau(pct) { // Streckenanteil → normierte Zeit
    const T = this.track.T;
    const f = pct * N, i = Math.floor(f) % N, u = f - Math.floor(f);
    return T[i] + (T[i + 1] - T[i]) * u;
  }
  _tauToPct(tau) { // normierte Zeit → Streckenanteil (binäre Suche)
    const T = this.track.T;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= tau) lo = m; else hi = m; }
    const u = (tau - T[lo]) / ((T[lo + 1] - T[lo]) || 1);
    return (lo + u) / N;
  }

  step(dt) {
    this.sessionTime += dt;
    this.timeRemain -= dt;
    if (this.timeRemain < -120) this.reset();
    for (const c of this.cars) {
      const before = Math.floor(c.progress);
      let speedFactor = 1 / c.thisLapFactor;
      if (c.pitTimer > 0) { c.pitTimer -= dt; speedFactor *= 0.18; }
      c.progress += (dt / c.lapTime) * speedFactor;
      if (Math.floor(c.progress) !== before) { // Start/Ziel überquert
        const t = this.sessionTime - c.lapStartSession;
        if (t > c.lapTime * 0.9) {
          c.lastLap = t;
          if (c.bestLap < 0 || t < c.bestLap) c.bestLap = t;
        }
        c.lapStartSession = this.sessionTime;
        c.thisLapFactor = 1 + (this.rand() - 0.42) * 0.008;
        if (c.idx !== this.playerIdx && this.rand() < 0.025) c.pitTimer = 26;
      }
      if (c.idx === this.playerIdx) this.fuel = Math.max(0, this.fuel - (dt / c.lapTime) * this.burn * (0.98 + this.rand() * 0.04));
    }
  }

  read() {
    const tr = this.track;
    const me = this.cars[this.playerIdx];
    const ordered = [...this.cars].sort((a, b) => b.progress - a.progress);
    const leader = ordered[0];
    const ref = tr.lapTime;

    const cars = this.cars.map((c) => {
      const tau = c.progress % 1;
      const pct = this._tauToPct(tau);
      return {
        idx: c.idx,
        pct,
        lap: Math.floor(c.progress) + 1,
        lapCompleted: Math.floor(c.progress),
        position: ordered.indexOf(c) + 1,
        classPosition: ordered.indexOf(c) + 1,
        lastLap: c.lastLap,
        bestLap: c.bestLap,
        estTime: tau * ref,
        f2Time: (leader.progress - c.progress) * ref,
        onPit: c.pitTimer > 0,
        inWorld: true,
      };
    });

    // Fahrer-Eingaben aus dem Geschwindigkeitsprofil ableiten
    const pc = cars[this.playerIdx].pct;
    const i = Math.floor(pc * N) % N;
    const v = tr.v[i] * (ref / me.lapTime);
    const vNext = tr.v[(i + 2) % N] * (ref / me.lapTime);
    const acc = (vNext * vNext - v * v) / (2 * 2 * tr.ds);
    const brake = acc < -2 ? Math.min(1, -acc / 13) : 0;
    let throttle = acc > 0.3 ? Math.min(1, 0.45 + acc / 6) : (v > 70 ? 1 : (brake > 0 ? 0 : 0.38 + 0.1 * Math.sin(this.sessionTime * 7)));
    throttle = Math.max(0, Math.min(1, throttle));
    const steer = Math.max(-4, Math.min(4, Math.atan(2.7 * tr.k[i]) * 15));
    const kmh = v * 3.6;
    const gear = kmh < 75 ? 2 : kmh < 115 ? 3 : kmh < 155 ? 4 : kmh < 195 ? 5 : 6;
    const tops = [0, 0, 75, 115, 155, 195, 270];
    const rpm = 5200 + 3800 * Math.min(1, Math.max(0, (kmh - (tops[gear - 1] || 0) * 0.85) / ((tops[gear] - (tops[gear - 1] || 0) * 0.85) || 1)));

    // Delta zur Bestzeit: verläuft entlang der Runde, plus leichtes Rauschen
    const tau = me.progress % 1;
    const lapGap = me.lapTime * me.thisLapFactor - me.bestLap;
    const delta = lapGap * tau + 0.06 * Math.sin(tau * Math.PI * 6);
    const deltaRate = (lapGap / me.lapTime) + 0.06 * Math.cos(tau * Math.PI * 6) * (Math.PI * 6 / me.lapTime);
    const sessionBest = Math.min(...this.cars.map((c) => c.bestLap).filter((x) => x > 0));

    return {
      connected: true,
      demo: true,
      sessionUid: 'demo',
      track: { id: 9999, name: 'Red Bull Ring', config: 'Grand Prix', length: '4.32 km' },
      session: { type: 'Race', timeRemain: Math.max(0, this.timeRemain), lapsRemain: null, time: this.sessionTime, flags: 0 },
      playerIdx: this.playerIdx,
      car: {
        fuel: this.fuel,
        fuelMax: this.fuelMax,
        onPit: false,
        lap: Math.floor(me.progress) + 1,
        lapCompleted: Math.floor(me.progress),
        lapDistPct: pc,
        lapCurrent: this.sessionTime - me.lapStartSession,
        lapLast: me.lastLap,
        lapBest: me.bestLap,
        deltaBest: delta,
        deltaBestRate: deltaRate,
        deltaBestOk: true,
        deltaSession: delta + (me.bestLap - sessionBest) * tau,
        deltaSessionRate: deltaRate,
        deltaSessionOk: true,
        throttle,
        brake,
        clutch: 0,
        steer,
        steerMax: 7.85,
        gear,
        speed: v,
        rpm,
        abs: brake > 0.85,
        onTrack: true,
      },
      drivers: this.cars.map((c) => ({
        idx: c.idx, name: c.name, abbrev: '', number: c.number, classId: 1, className: 'GT3', classColor: 'var(--gold)', // Demo: Klassenfarbe = Akzentfarbe
        classEstLap: ref, iRating: c.iRating, license: c.license, safety: c.safety, licColor: '#0153db', carName: c.carName,
      })),
      cars,
      trackPath: tr.pts,
    };
  }
}

module.exports = { DemoSource, buildTrack };
