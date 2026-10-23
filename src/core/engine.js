'use strict';
// Engine: rechnet aus dem raw-Snapshot alles, was die Overlays anzeigen.
// Reine Logik ohne Electron/iRacing-Abhängigkeit → testbar.
//
// Optionen einzelner Overlays (Anzahl Autos im Relative, Klassenfilter, Sprit-Reserve …) wendet
// jede Anzeige selbst an. So können mehrere Layouts und Stream-Overlays gleichzeitig mit
// unterschiedlichen Einstellungen laufen. Die Engine liefert dafür jeweils das Maximum.
const { sessionCategory } = require('../../web/shared/defaults');
const { compute: computeFuel } = require('../../web/shared/fuel-calc');

const REL_MAX = 8; // so viele Autos vor/hinter dir liefert die Engine; die Anzeige schneidet zu

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
  // Rohdaten für die Anzeige (gerechnet wird dort mit den Optionen des Overlays)
  raw(snapshot, fallbackLap) {
    const car = snapshot.car, s = snapshot.session;
    return {
      fuel: car.fuel, tank: car.fuelMax, laps: this.laps.slice(), lapTimes: this.lapTimes.slice(),
      lapsRemain: s.lapsRemain, timeRemain: s.timeRemain, lapDistPct: car.lapDistPct,
      lapCompleted: car.lapCompleted, lapBest: car.lapBest, fallbackLap,
    };
  }
  // Für Tests und Abwärtskompatibilität: direkt mit Optionen rechnen
  compute(snapshot, opts, fallbackLap) {
    return computeFuel(this.raw(snapshot, fallbackLap), opts);
  }
}

class Engine {
  constructor() {
    this.fuel = new FuelTracker();
    this.sessionUid = null;
  }

  frame(raw, _settings, trackInfo) {
    if (!raw || !raw.connected) {
      return { status: 'waiting', t: Date.now(), category: null };
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

    return {
      status: raw.demo ? 'demo' : 'live',
      t: Date.now(),
      category: sessionCategory(raw.session.type),
      track: raw.track,
      session: raw.session,
      me: { idx: raw.playerIdx, name: meD.name, number: meD.number, classId: meD.classId, position: me ? me.position : 0, classPosition: me ? me.classPosition : 0, lap: raw.car.lap },
      relative: me ? this.relative(raw, me, drivers, refLap) : [],
      standings: this.standings(raw, drivers),
      fuel: this.fuel.raw(raw, refLap),
      inputs: {
        throttle: raw.car.throttle, brake: raw.car.brake, clutch: raw.car.clutch,
        steer: raw.car.steer, steerMax: raw.car.steerMax, gear: raw.car.gear,
        speed: raw.car.speed, rpm: raw.car.rpm, abs: raw.car.abs,
      },
      delta: this.delta(raw.car),
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

  // Bis zu REL_MAX Autos vor und hinter dir, geordnet von «weit vorn» bis «weit hinten».
  relative(raw, me, drivers, refLap) {
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
    const front = rows.filter((r) => !r.me && r.gap > 0).sort((a, b) => a.gap - b.gap).slice(0, REL_MAX).reverse();
    const back = rows.filter((r) => !r.me && r.gap <= 0).sort((a, b) => b.gap - a.gap).slice(0, REL_MAX);
    const self = rows.find((r) => r.me);
    return [...front, ...(self ? [self] : []), ...back];
  }

  // Vollständige Rangliste aller Autos. Abstände jeweils zum Gesamt- und zum Klassenführenden;
  // Klassenfilter und Ausschnitt wählt die Anzeige.
  standings(raw, drivers) {
    const list = [];
    for (const c of raw.cars) {
      const d = drivers.get(c.idx);
      if (d) list.push({ c, d });
    }
    const isRace = /race/i.test(raw.session.type || '');
    const key = ({ c }) => (c.position > 0 ? c.position : 1000 + (c.bestLap > 0 ? c.bestLap : 1e6));
    list.sort((a, b) => key(a) - key(b));

    const gapTo = (c, leader) => {
      if (!leader || c === leader) return { gap: null, laps: 0 };
      if (isRace) {
        const down = (leader.lapCompleted + leader.pct) - (c.lapCompleted + c.pct);
        if (down >= 1) return { gap: null, laps: Math.floor(down) };
        return { gap: Math.max(0, c.f2Time - leader.f2Time), laps: 0 };
      }
      return { gap: (c.bestLap > 0 && leader.bestLap > 0) ? c.bestLap - leader.bestLap : null, laps: 0 };
    };
    const classLeader = new Map();
    const classBest = new Map();
    let overallBest = Infinity;
    for (const { c, d } of list) {
      if (!classLeader.has(d.classId)) classLeader.set(d.classId, c);
      if (c.bestLap > 0) {
        overallBest = Math.min(overallBest, c.bestLap);
        classBest.set(d.classId, Math.min(classBest.get(d.classId) ?? Infinity, c.bestLap));
      }
    }
    const classCount = new Map();
    return list.map(({ c, d }, i) => {
      const n = (classCount.get(d.classId) || 0) + 1;
      classCount.set(d.classId, n);
      const go = gapTo(c, list[0].c);
      const gc = gapTo(c, classLeader.get(d.classId));
      return {
        pos: c.position || i + 1, classPos: c.classPosition || n,
        idx: c.idx, me: c.idx === raw.playerIdx, number: d.number, name: d.name, carName: d.carName,
        classId: d.classId, classColor: d.classColor, className: d.className,
        iRating: d.iRating, license: d.license, safety: d.safety, licColor: d.licColor,
        lastLap: c.lastLap, bestLap: c.bestLap,
        fastest: c.bestLap > 0 && c.bestLap === overallBest,
        fastestClass: c.bestLap > 0 && c.bestLap === classBest.get(d.classId),
        gap: go.gap, gapLaps: go.laps, gapClass: gc.gap, gapLapsClass: gc.laps,
        onPit: c.onPit, lap: c.lap,
      };
    });
  }

  delta(car) {
    const best = car.lapBest > 0 ? car.lapBest : null;
    const pack = (ok, value, rate, predict) => ({ ok: !!ok && best !== null, value, rate, predicted: ok && best && predict ? best + value : null });
    return {
      best, last: car.lapLast > 0 ? car.lapLast : null, current: car.lapCurrent,
      vsBest: pack(car.deltaBestOk, car.deltaBest, car.deltaBestRate, true),
      // Gegen die Session-Bestzeit lässt sich keine eigene Rundenzeit vorhersagen
      vsSession: pack(car.deltaSessionOk, car.deltaSession, car.deltaSessionRate, false),
    };
  }
}

module.exports = { Engine, FuelTracker, wrap, REL_MAX };
