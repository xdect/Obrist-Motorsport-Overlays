'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Engine, FuelTracker, wrap } = require('../src/core/engine');
const { DemoSource } = require('../src/core/sources/demo');
const { defaults } = require('../src/core/settings');

test('wrap bildet Lücken korrekt auf eine halbe Runde ab', () => {
  assert.strictEqual(wrap(80, 45), -10);
  assert.strictEqual(wrap(-80, 45), 10);
  assert.strictEqual(wrap(5, 45), 5);
});

test('Fuel: Verbrauch pro Runde, Boxenrunden werden ignoriert', () => {
  const f = new FuelTracker();
  const car = { fuel: 60, lapCompleted: 10, onPit: false, lapLast: 88, lapDistPct: 0, lapBest: 88, fuelMax: 120 };
  f.update(car);
  f.update({ ...car, fuel: 57, lapCompleted: 11 });   // 3.0
  f.update({ ...car, fuel: 54.2, lapCompleted: 12 }); // 2.8
  f.update({ ...car, fuel: 54.0, onPit: true, lapCompleted: 12 });
  f.update({ ...car, fuel: 100, onPit: true, lapCompleted: 12 }); // nachgetankt
  f.update({ ...car, fuel: 97, lapCompleted: 13 });   // Boxenrunde → ignoriert
  f.update({ ...car, fuel: 94.1, lapCompleted: 14 }); // 2.9
  assert.deepStrictEqual(f.laps.map((x) => +x.toFixed(2)), [3, 2.8, 2.9]);
  const raw = { car: { ...car, fuel: 30, lapCompleted: 14, lapDistPct: 0 }, session: { lapsRemain: 20, timeRemain: -1 } };
  const r = f.compute(raw, { avgLaps: 5, marginLaps: 0.5 }, 88);
  assert.ok(Math.abs(r.avg - 2.9) < 1e-9);
  // 21 Runden * 2.9 + 1.45 Reserve - 30 = 32.35
  assert.ok(Math.abs(r.toAdd - 32.35) < 1e-6, String(r.toAdd));
  assert.strictEqual(r.stops, 1);
});

test('Demo + Engine: Relative und Standings plausibel', () => {
  const demo = new DemoSource();
  const engine = new Engine();
  const s = defaults();
  let fr;
  for (let i = 0; i < 300; i++) { demo.step(1 / 30); fr = engine.frame(demo.read(), s, null); }
  assert.strictEqual(fr.status, 'demo');
  const meI = fr.relative.findIndex((r) => r.me);
  assert.ok(meI >= 0);
  // oberhalb positive Lücken (voraus), unterhalb negative
  fr.relative.slice(0, meI).forEach((r) => assert.ok(r.gap > 0));
  fr.relative.slice(meI + 1).forEach((r) => assert.ok(r.gap <= 0));
  assert.ok(fr.relative.length <= 9);
  assert.ok(fr.standings.some((r) => r.me));
  assert.strictEqual(fr.standings[0].pos, 1);
  assert.ok(fr.fuel.fuel > 0);
  assert.ok(fr.map.cars.length === 22);
});

test('Demo: Fuel-Durchschnitt nach ein paar Runden vorhanden', () => {
  const demo = new DemoSource();
  const engine = new Engine();
  const s = defaults();
  let fr;
  for (let i = 0; i < 30 * 60 * 4; i++) { demo.step(1 / 30); fr = engine.frame(demo.read(), s, null); }
  assert.ok(fr.fuel.samples >= 1, 'keine Runde gezählt');
  assert.ok(fr.fuel.avg > 2.5 && fr.fuel.avg < 3.2, String(fr.fuel.avg));
  assert.ok(fr.fuel.lapsToGo > 0);
  console.log('Demo-Rundenzeit', demo.track.lapTime.toFixed(2), 's; Fuel', JSON.stringify(fr.fuel));
});
