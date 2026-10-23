'use strict';
// Engine: rechnet aus dem raw-Snapshot alles, was die Overlays anzeigen.
// Reine Logik ohne Electron/iRacing-Abhängigkeit → testbar.

const wrap = (x, half) => { // auf (-half, half] abbilden
  const full = half * 2;
  let r = ((x + half) % full + full) % full - half;
  if (r === -half) r = half;
  return r;
};

class FuelTracker {
  constructor() { this.reset(); }
  reset() {
    this.laps = [];        // Verbrauch pro Runde (Liter)
    this.lapTimes = [];    // gültige Rundenzeiten
    this.lastLapCompleted = null;
    this.fuelAtLapStart = null;
    this.pitThisLap = false;
    this.lastFuel = null;
  }
  update(car) {
    if (car.onPit) this.pitThisLap = true;
    // Nachtanken erkannt → Startwert der Runde neu setzen
    if (this.lastFuel !== null && car.fuel > this.lastFuel + 0.3) {
      this.fuelAtLapStart = car.fuel;
      this.pitThisLap = true;
    }
    if (this.lastLapCompleted === null) {
      this.lastLapCompleted = car.lapCompleted;
      this.fuelAtLapStart = car.fuel;
      // Einstieg mitten in der Runde → diese Runde ist unvollständig und zählt nicht
      this.pitThisLap = (car.lapDistPct ?? 0) > 0.02;
    } else if (car.lapCompleted > this.lastLapCompleted) {
      const used = this.fuelAtLapStart - car.fuel;
      if (!this.pitThisLap && used > 0.05 && car.lapCompleted === this.lastLapCompleted + 1) {
        this.laps.push(used);
        if (this.laps.length > 30) this.laps.shift();
        if (car.lapLast > 0) { this.lapTimes.push(car.lapLast); if (this.lapTimes.length > 30) this.lapTimes.shift(); }
      }
      this.lastLapCompleted = car.lapCompleted;
      this.fuelAtLapStart = car.fuel;
      this.pitThisLap = !!car.onPit;
    } else if (car.lapCompleted < this.lastLapCompleted) { // Session-Wechsel/Reset
      this.lastLapCompleted = car.lapCompleted;
      this.fuelAtLapStart = car.fuel;
    }
    this.lastFuel = car.fuel;
  }
  // Ergebnis für das Fuel-Overlay
  compute(raw, opts, fallbackLapTime) {
    const car = raw.car;
    const n = Math.max(1, opts.avgLaps || 5);
    const recent = this.laps.slice(-n);
    const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
    const max = recent.length ? Math.max(...recent) : null;
    const last = this.laps.length ? this.laps[this.laps.length - 1] : null;
    const times = this.lapTimes.slice(-n);
    const refLap = times.length ? times.reduce((a, b) => a + b, 0) / times.length
      : (car.lapBest > 0 ? car.lapBest : fallbackLapTime || null);

    const lapsOfFuel = avg ? car.fuel / avg : null;
    // Verbleibende Rennrunden ab jetzt (inkl. laufender Runde)
    let lapsToGo = null;
    const s = raw.session;
    const lapFrac = car.lapDistPct >= 0 ? car.lapDistPct : 0;
    if (s.lapsRemain !== null && s.lapsRemain !== undefined && s.lapsRemain >= 0) {
      lapsToGo = Math.max(0, s.lapsRemain + 1 - lapFrac);
    } else if (s.timeRemain > 0 && refLap) {
      // Zeitrennen: Zeit bis Fahnenschwenk + die Runde, in der sie fällt
      const lapsByTime = s.timeRemain / refLap;
      lapsToGo = Math.max(0, Math.ceil(lapsByTime + lapFrac) - lapFrac);
    }
    const margin = (opts.marginLaps ?? 0.5) * (avg || 0);
    const needTotal = (lapsToGo !== null && avg) ? lapsToGo * avg + margin : null;
    const toAdd = needTotal !== null ? Math.max(0, needTotal - car.fuel) : null;
    const tank = car.fuelMax > 0 ? car.fuelMax : null;
    const stops = (toAdd !== null && tank) ? Math.ceil(toAdd / tank - 1e-9) : null;
    // Spätestens boxen in Runde X (eine Runde Reserve)
    const pitLap = (lapsOfFuel !== null) ? car.lapCompleted + Math.max(0, Math.floor(lapsOfFuel + lapFrac) - 1) + 1 : null;
    return {
      fuel: car.fuel, tank, avg, max, last, lapsOfFuel, lapsToGo, toAdd, stops, pitLap,
      samples: this.laps.length, refLap, enough: toAdd === 0,
    };
  }
}

class Engine {
  constructor() {
    this.fuel = new FuelTracker();
    this.sessionUid = null;
  }

  frame(raw, settings, trackInfo) {
    if (!raw || !raw.connected) {
      return { status: 'waiting', t: Date.now() };
    }
    if (raw.sessionUid !== this.sessionUid) {
      this.sessionUid = raw.sessionUid;
      this.fuel.reset();
    }
    this.fuel.update(raw.car);

    const drivers = new Map(raw.drivers.map((d) => [d.idx, d]));
    const me = raw.cars.find((c) => c.idx === raw.playerIdx);
    const meD = drivers.get(raw.playerIdx) || {};
    const refLap = meD.classEstLap > 0 ? meD.classEstLap
      : (raw.car.lapBest > 0 ? raw.car.lapBest : 90);

    const o = settings.overlays;
    return {
      status: raw.demo ? 'demo' : 'live',
      t: Date.now(),
      track: raw.track,
      session: raw.session,
      me: { idx: raw.playerIdx, name: meD.name, number: meD.number, position: me ? me.position : 0, classPosition: me ? me.classPosition : 0, lap: raw.car.lap },
      relative: me ? this.relative(raw, me, drivers, refLap, o.relative) : [],
      standings: this.standings(raw, drivers, meD, o.standings),
      fuel: this.fuel.compute(raw, o.fuel, refLap),
      inputs: {
        throttle: raw.car.throttle, brake: raw.car.brake, clutch: raw.car.clutch,
        steer: raw.car.steer, steerMax: raw.car.steerMax, gear: raw.car.gear,
        speed: raw.car.speed, rpm: raw.car.rpm, abs: raw.car.abs,
      },
      delta: this.delta(raw.car, o.delta),
      map: {
        cars: raw.cars.filter((c) => c.inWorld).map((c) => {
          const d = drivers.get(c.idx) || {};
          return { idx: c.idx, pct: c.pct, number: d.number, color: d.classColor, me: c.idx === raw.playerIdx, pos: c.position, pit: c.onPit };
        }),
        recording: trackInfo ? trackInfo.recording : false,
        progress: trackInfo ? trackInfo.progress : 1,
      },
    };
  }

  relative(raw, me, drivers, refLap, opts) {
    const ahead = opts.carsAhead ?? 4, behind = opts.carsBehind ?? 4;
    const myDist = me.lapCompleted + me.pct;
    const rows = [];
    for (const c of raw.cars) {
      if (!c.inWorld || c.pct < 0) continue;
      const d = drivers.get(c.idx);
      if (!d) continue;
      let gap;
      if (c.idx === me.idx) gap = 0;
      else if (me.estTime > 0 || c.estTime > 0) {
        // EstTime = geschätzte Zeit vom Start/Ziel bis zur aktuellen Position (Klassen-Referenz)
        gap = wrap(c.estTime - me.estTime, refLap / 2);
      } else {
        gap = wrap(c.pct - me.pct, 0.5) * refLap;
      }
      const distDiff = (c.lapCompleted + c.pct) - myDist;
      // Rundenbezug: >0.5 Runde voraus = überrundet mich, < -0.5 = wird von mir überrundet
      const lapRel = c.idx === me.idx ? 0 : (distDiff > 0.5 ? 1 : distDiff < -0.5 ? -1 : 0);
      rows.push({
        idx: c.idx, me: c.idx === me.idx, gap, lapRel,
        position: c.position, classPosition: c.classPosition, number: d.number, name: d.name,
        classColor: d.classColor, iRating: d.iRating, license: d.license, safety: d.safety, licColor: d.licColor,
        onPit: c.onPit, carName: d.carName,
      });
    }
    // gap > 0 = Auto vor mir auf der Strecke
    const front = rows.filter((r) => !r.me && r.gap > 0).sort((a, b) => a.gap - b.gap).slice(0, ahead).reverse();
    const back = rows.filter((r) => !r.me && r.gap <= 0).sort((a, b) => b.gap - a.gap).slice(0, behind);
    const self = rows.find((r) => r.me);
    return [...front, ...(self ? [self] : []), ...back];
  }

  standings(raw, drivers, meD, opts) {
    const list = [];
    for (const c of raw.cars) {
      const d = drivers.get(c.idx);
      if (!d) continue;
      if (opts.classFilter === 'mine' && meD.classId !== undefined && d.classId !== meD.classId) continue;
      list.push({ c, d });
    }
    const isRace = /race/i.test(raw.session.type || '');
    const sortKey = ({ c }) => {
      if (c.position > 0) return c.position;
      return 1000 + (c.bestLap > 0 ? c.bestLap : 1e6); // noch ohne Position: nach Bestzeit
    };
    list.sort((a, b) => sortKey(a) - sortKey(b));

    // Klassenführender als Referenz
    const leader = list[0] ? list[0].c : null;
    const bestOverall = Math.min(...list.map(({ c }) => (c.bestLap > 0 ? c.bestLap : Infinity)));
    const rows = list.map(({ c, d }, i) => {
      let gap = null, gapLaps = 0;
      if (leader && c !== leader) {
        if (isRace) {
          const lapsDown = (leader.lapCompleted + leader.pct) - (c.lapCompleted + c.pct);
          if (lapsDown >= 1) gapLaps = Math.floor(lapsDown);
          else gap = Math.max(0, c.f2Time - leader.f2Time);
        } else if (c.bestLap > 0 && leader.bestLap > 0) {
          gap = c.bestLap - leader.bestLap;
        }
      }
      return {
        pos: opts.classFilter === 'mine' ? (c.classPosition || i + 1) : (c.position || i + 1),
        idx: c.idx, me: c.idx === raw.playerIdx, number: d.number, name: d.name, carName: d.carName,
        classColor: d.classColor, className: d.className, iRating: d.iRating, license: d.license, safety: d.safety,
        licColor: d.licColor, lastLap: c.lastLap, bestLap: c.bestLap, fastest: c.bestLap > 0 && c.bestLap === bestOverall,
        gap, gapLaps, onPit: c.onPit, lap: c.lap,
      };
    });
    // Fenster so schneiden, dass ich immer sichtbar bin (Top 3 + Umfeld)
    const max = opts.rows || 16;
    if (rows.length <= max) return rows;
    const meI = rows.findIndex((r) => r.me);
    if (meI < max) return rows.slice(0, max);
    const top = rows.slice(0, 3);
    const rest = max - 3;
    let start = Math.max(3, meI - Math.floor(rest / 2));
    start = Math.min(start, rows.length - rest);
    return [...top, { gapRow: true }, ...rows.slice(start + 1, start + rest)];
  }

  delta(car, opts) {
    const useSession = opts.reference === 'session';
    const ok = useSession ? car.deltaSessionOk : car.deltaBestOk;
    const value = useSession ? car.deltaSession : car.deltaBest;
    const rate = useSession ? car.deltaSessionRate : car.deltaBestRate;
    const best = car.lapBest > 0 ? car.lapBest : null;
    return {
      ok: !!ok && best !== null, value, rate, reference: useSession ? 'session' : 'best',
      best, last: car.lapLast > 0 ? car.lapLast : null, current: car.lapCurrent,
      predicted: ok && best ? best + value : null,
    };
  }
}

module.exports = { Engine, FuelTracker, wrap };
