'use strict';
const test = require('node:test');
const assert = require('node:assert');
const yaml = require('../src/core/yaml-lite');
const { IRacingSource, VARS } = require('../src/core/sources/iracing');
const { Engine } = require('../src/core/engine');
const { defaults } = require('../src/core/settings');

const SESSION = `---
WeekendInfo:
 TrackName: redbullring gp
 TrackID: 341
 TrackLength: 4.26 km
 TrackDisplayName: Red Bull Ring
 TrackConfigName: Grand Prix
 SessionID: 271118391
 SubSessionID: 71234567
 WeekendOptions:
  NumStarters: 3
  CommercialMode: consumer
 TelemetryOptions:
  TelemetryDiskFile: ""

SessionInfo:
 Sessions:
 - SessionNum: 0
   SessionLaps: unlimited
   SessionTime: 600.0000 sec
   SessionType: Practice
   ResultsPositions:
   ResultsFastestLap:
   - CarIdx: 255
     FastestLap: 0
 - SessionNum: 1
   SessionLaps: unlimited
   SessionTime: 2700.0000 sec
   SessionType: Race
   ResultsPositions:
   - Position: 1
     ClassPosition: 0
     CarIdx: 2

DriverInfo:
 DriverCarIdx: 1
 DriverCarFuelMaxLtr: 120.000
 DriverCarMaxFuelPct: 1.000
 Drivers:
 - CarIdx: 0
   UserName: Pace Car
   CarNumber: "0"
   CarIsPaceCar: 1
   IsSpectator: 0
   CarClassID: 11
 - CarIdx: 1
   UserName: Mischa Obrist
   AbbrevName:
   CarNumber: "13"
   CarClassID: 2708
   CarClassShortName: GT3
   CarClassColor: 0xffda59
   CarClassEstLapTime: 88.1234
   IRating: 3124
   LicString: A 4.21
   LicColor: 0x0153db
   CarScreenNameShort: Porsche 911 GT3 R (992)
   CarIsPaceCar: 0
   IsSpectator: 0
 - CarIdx: 2
   UserName: Jürgen "JJ" Müller: Racing
   CarNumber: 007
   CarClassID: 2708
   CarClassColor: 0xffda59
   CarClassEstLapTime: 88.1234
   IRating: 4510
   LicString: P 3.88
   CarScreenNameShort: BMW M4 GT3
   CarIsPaceCar: 0
   IsSpectator: 0
...
`;

test('yaml-lite liest iRacing-Session inklusive Sonderfällen', () => {
  const s = yaml.parse(SESSION);
  assert.strictEqual(s.WeekendInfo.TrackID, 341);
  assert.strictEqual(s.WeekendInfo.TrackDisplayName, 'Red Bull Ring');
  assert.strictEqual(s.WeekendInfo.WeekendOptions.NumStarters, 3);
  assert.strictEqual(s.WeekendInfo.TelemetryOptions.TelemetryDiskFile, '');
  assert.strictEqual(s.SessionInfo.Sessions.length, 2);
  assert.strictEqual(s.SessionInfo.Sessions[0].ResultsPositions, null);
  assert.strictEqual(s.SessionInfo.Sessions[0].ResultsFastestLap[0].CarIdx, 255);
  assert.strictEqual(s.SessionInfo.Sessions[1].SessionType, 'Race');
  assert.strictEqual(s.SessionInfo.Sessions[1].ResultsPositions[0].CarIdx, 2);
  assert.strictEqual(s.DriverInfo.DriverCarIdx, 1);
  assert.strictEqual(s.DriverInfo.Drivers.length, 3);
  const d = s.DriverInfo.Drivers;
  assert.strictEqual(d[1].CarNumber, '13');
  assert.strictEqual(d[1].AbbrevName, null);
  assert.strictEqual(d[2].CarNumber, '007');                       // führende Null bleibt
  assert.strictEqual(d[2].UserName, 'Jürgen "JJ" Müller: Racing'); // Sonderzeichen unverändert
});

test('IRacingSource baut aus Modul-Daten einen gültigen Snapshot', () => {
  const src = new IRacingSource();
  const n = 64;
  const fill = (v) => Array.from({ length: n }, () => v);
  const vars = {
    SessionNum: 1, SessionTime: 500.5, SessionTimeRemain: 1800, SessionLapsRemainEx: 32767, SessionFlags: 0,
    PlayerCarIdx: 1, IsOnTrack: true, OnPitRoad: false,
    CarIdxLapDistPct: Object.assign(fill(-1), { 0: 0.1, 1: 0.5, 2: 0.55 }),
    CarIdxLap: Object.assign(fill(-1), { 1: 6, 2: 6 }),
    CarIdxLapCompleted: Object.assign(fill(-1), { 1: 5, 2: 5 }),
    CarIdxPosition: Object.assign(fill(0), { 1: 2, 2: 1 }),
    CarIdxClassPosition: Object.assign(fill(0), { 1: 2, 2: 1 }),
    CarIdxLastLapTime: Object.assign(fill(-1), { 1: 88.9, 2: 88.4 }),
    CarIdxBestLapTime: Object.assign(fill(-1), { 1: 88.5, 2: 88.2 }),
    CarIdxEstTime: Object.assign(fill(0), { 1: 44.0, 2: 48.4 }),
    CarIdxF2Time: Object.assign(fill(0), { 1: 4.4, 2: 0 }),
    CarIdxOnPitRoad: fill(false),
    CarIdxTrackSurface: Object.assign(fill(-1), { 0: 3, 1: 3, 2: 3 }),
    FuelLevel: 55.2, Lap: 6, LapCompleted: 5, LapDistPct: 0.5, LapCurrentLapTime: 44, LapLastLapTime: 88.9, LapBestLapTime: 88.5,
    LapDeltaToBestLap: 0.21, LapDeltaToBestLap_DD: 0.01, LapDeltaToBestLap_OK: true,
    LapDeltaToSessionBestLap: 0.5, LapDeltaToSessionBestLap_DD: 0, LapDeltaToSessionBestLap_OK: true,
    Throttle: 1, Brake: 0, Clutch: 1, SteeringWheelAngle: 0.1, SteeringWheelAngleMax: 7.85, Gear: 5, Speed: 60, RPM: 7000,
    BrakeABSactive: false, VelocityX: 60, VelocityY: 0, Yaw: 0,
  };
  for (const k of Object.keys(vars)) assert.ok(VARS.includes(k), `${k} fehlt in VARS`);
  src.start = () => {}; // kein Prozess im Test
  src._onLine(JSON.stringify({ t: 'status', connected: true }));
  src._onLine(JSON.stringify({ t: 'session', update: 3, yaml: SESSION }));
  src._onLine(JSON.stringify({ t: 'tele', tick: 100, vars }));
  const raw = src.read();
  assert.ok(raw);
  assert.strictEqual(raw.track.name, 'Red Bull Ring');
  assert.strictEqual(raw.session.type, 'Race');
  assert.strictEqual(raw.drivers.length, 2); // Pace Car gefiltert
  assert.strictEqual(raw.car.fuelMax, 120);
  assert.strictEqual(raw.drivers[0].classColor, '#ffda59');
  assert.strictEqual(raw.car.clutch, 0);

  const fr = new Engine().frame(raw, defaults(), null);
  assert.strictEqual(fr.status, 'live');
  const ahead = fr.relative.find((r) => r.number === '007');
  assert.ok(ahead && Math.abs(ahead.gap - 4.4) < 1e-6, JSON.stringify(fr.relative));
  assert.strictEqual(fr.standings[0].number, '007');
  assert.ok(Math.abs(fr.standings[1].gap - 4.4) < 1e-6);

  // Verbindung weg → kein Snapshot
  src._onLine(JSON.stringify({ t: 'status', connected: false }));
  assert.strictEqual(src.read(), null);
});
