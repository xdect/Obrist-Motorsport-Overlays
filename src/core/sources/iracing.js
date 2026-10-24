'use strict';
// iRacing-Datenquelle: startet das mitgelieferte Modul om-telemetry.exe, das die Telemetrie
// aus dem Shared Memory von iRacing liest und als JSON-Zeilen liefert.
// Daraus entsteht pro Abruf ein normalisierter "raw"-Snapshot für die Engine.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const yaml = require('../yaml-lite');

const VARS = [
  'SessionInfoUpdate', 'SessionNum', 'SessionTime', 'SessionTimeRemain', 'SessionLapsRemainEx', 'SessionFlags',
  'PlayerCarIdx', 'IsOnTrack', 'IsInGarage', 'IsReplayPlaying', 'OnPitRoad',
  'CarIdxLapDistPct', 'CarIdxLap', 'CarIdxLapCompleted', 'CarIdxPosition', 'CarIdxClassPosition',
  'CarIdxLastLapTime', 'CarIdxBestLapTime', 'CarIdxEstTime', 'CarIdxF2Time', 'CarIdxOnPitRoad', 'CarIdxTrackSurface',
  'FuelLevel', 'Lap', 'LapCompleted', 'LapDistPct', 'LapCurrentLapTime', 'LapLastLapTime', 'LapBestLapTime',
  'LapDeltaToBestLap', 'LapDeltaToBestLap_DD', 'LapDeltaToBestLap_OK',
  'LapDeltaToSessionBestLap', 'LapDeltaToSessionBestLap_DD', 'LapDeltaToSessionBestLap_OK',
  'Throttle', 'Brake', 'Clutch', 'SteeringWheelAngle', 'SteeringWheelAngleMax', 'Gear', 'Speed', 'RPM',
  'BrakeABSactive', 'VelocityX', 'VelocityY', 'Yaw',
  'EngineWarnings', 'LatAccel', 'LongAccel', 'AirTemp', 'TrackTempCrew', 'PlayerCarMyIncidentCount',
  'SessionTimeTotal', 'SessionLapsTotal',
  // Reifen: Temperatur innen/mitte/aussen und Verschleiss (iRacing misst beides beim Boxenstopp)
  ...['LF', 'RF', 'LR', 'RR'].flatMap((t) => [`${t}tempCL`, `${t}tempCM`, `${t}tempCR`, `${t}wearL`, `${t}wearM`, `${t}wearR`]),
];

// «4.26 km» / «2.65 mi» → Meter
function lengthMeters(s) {
  const v = parseFloat(s);
  if (!Number.isFinite(v)) return 0;
  return /mi/i.test(String(s)) ? v * 1609.344 : v * 1000;
}
// «80.00 kph» / «45.00 mph» → km/h
function speedKph(s) {
  const v = parseFloat(s);
  if (!Number.isFinite(v)) return null;
  return /mph/i.test(String(s)) ? v * 1.609344 : v;
}

function hexColor(v) {
  if (v === undefined || v === null || v === '') return '#c8a24c';
  const n = typeof v === 'string' ? parseInt(v, v.toLowerCase().startsWith('0x') ? 16 : 10) : v;
  if (!Number.isFinite(n)) return '#c8a24c';
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

function findHelper() {
  const candidates = [
    process.env.OM_TELEMETRY_EXE,
    path.join(__dirname, '..', '..', '..', 'bin', 'om-telemetry.exe'),
    process.resourcesPath && path.join(process.resourcesPath, 'app', 'bin', 'om-telemetry.exe'),
  ].filter(Boolean);
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

class IRacingSource {
  constructor() {
    this.exe = null;
    this.proc = null;
    this.available = false;
    this.error = null;
    this.connected = false;
    this.vars = null;
    this.session = null;
    this.sessionUpdate = -1;
    this.lastTele = 0;
    this.restartAt = 0;
  }

  async init() {
    if (process.platform !== 'win32' && !process.env.OM_TELEMETRY_EXE) {
      this.error = 'iRacing-Telemetrie gibt es nur unter Windows.';
      return false;
    }
    this.exe = findHelper();
    this.available = !!this.exe;
    if (!this.available) this.error = 'om-telemetry.exe nicht gefunden.';
    return this.available;
  }

  start() {
    if (!this.available || this.proc || Date.now() < this.restartAt) return;
    try {
      this.proc = spawn(this.exe, ['-vars', VARS.join(',')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) {
      this.error = e.message;
      this.restartAt = Date.now() + 5000;
      return;
    }
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => this._onLine(line));
    this.proc.on('exit', () => {
      this.proc = null;
      this.connected = false;
      this.restartAt = Date.now() + 2000; // abgestürzt → kurz warten, dann neu starten
    });
    this.proc.on('error', (e) => { this.error = e.message; });
  }

  stop() {
    if (this.proc) { try { this.proc.stdin.end(); this.proc.kill(); } catch { /* egal */ } }
    this.proc = null;
    this.connected = false;
    this.vars = null;
    this.session = null;
    this.sessionUpdate = -1;
  }

  _onLine(line) {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.t === 'status') {
      this.connected = !!m.connected;
      if (!this.connected) { this.vars = null; }
    } else if (m.t === 'session') {
      try { this.session = yaml.parse(m.yaml); this.sessionUpdate = m.update; } catch { /* nächstes Update */ }
    } else if (m.t === 'tele') {
      this.connected = true;
      this.vars = m.vars;
      this.lastTele = Date.now();
    }
  }

  // Gibt einen raw-Snapshot zurück oder null, wenn (noch) keine Daten da sind.
  read() {
    this.start();
    if (!this.connected || !this.vars || !this.session) return null;
    if (Date.now() - this.lastTele > 3000) return null; // Daten veraltet (Pause/Ladebildschirm)
    const tele = this.vars;

    const arr = (name) => {
      const v = tele[name];
      if (v === undefined || v === null) return [];
      return Array.isArray(v) ? v : [v];
    };
    const num = (name, d = 0) => { const x = arr(name)[0]; return (x === undefined || x === null) ? d : Number(x); };
    const bool = (name) => !!arr(name)[0];

    const S = this.session || {};
    const wi = S.WeekendInfo || {};
    const di = S.DriverInfo || {};
    const sessions = (S.SessionInfo && S.SessionInfo.Sessions) || [];
    const sessionNum = num('SessionNum', 0);
    const cur = sessions.find((x) => x.SessionNum === sessionNum) || sessions[sessionNum] || {};

    const playerIdx = num('PlayerCarIdx', di.DriverCarIdx || 0);
    const drivers = (di.Drivers || [])
      .filter((d) => d && !Number(d.IsSpectator) && !Number(d.CarIsPaceCar))
      .map((d) => {
        const lic = String(d.LicString || '');
        return {
          idx: Number(d.CarIdx),
          name: String(d.UserName ?? ''),
          abbrev: String(d.AbbrevName ?? ''),
          number: String(d.CarNumber ?? ''),
          classId: d.CarClassID,
          className: String(d.CarClassShortName || ''),
          classColor: hexColor(d.CarClassColor),
          classEstLap: Number(d.CarClassEstLapTime) || 0,
          iRating: Number(d.IRating) || 0,
          license: lic.split(' ')[0] || '',
          safety: lic.split(' ')[1] || '',
          licColor: hexColor(d.LicColor),
          carName: String(d.CarScreenNameShort || d.CarScreenName || ''),
        };
      });

    const pct = arr('CarIdxLapDistPct');
    const lap = arr('CarIdxLap');
    const lapC = arr('CarIdxLapCompleted');
    const pos = arr('CarIdxPosition');
    const cpos = arr('CarIdxClassPosition');
    const last = arr('CarIdxLastLapTime');
    const best = arr('CarIdxBestLapTime');
    const est = arr('CarIdxEstTime');
    const f2 = arr('CarIdxF2Time');
    const pit = arr('CarIdxOnPitRoad');
    const surf = arr('CarIdxTrackSurface');

    const cars = drivers.map((d) => ({
      idx: d.idx,
      pct: pct[d.idx] ?? -1,
      lap: lap[d.idx] ?? -1,
      lapCompleted: lapC[d.idx] ?? -1,
      position: pos[d.idx] ?? 0,
      classPosition: cpos[d.idx] ?? 0,
      lastLap: last[d.idx] ?? -1,
      bestLap: best[d.idx] ?? -1,
      estTime: est[d.idx] ?? 0,
      f2Time: f2[d.idx] ?? 0,
      onPit: !!pit[d.idx],
      inWorld: (surf[d.idx] ?? -1) !== -1 && (pct[d.idx] ?? -1) >= 0,
    }));

    const lapsRemainEx = num('SessionLapsRemainEx', 32767);
    const maxPct = Number(di.DriverCarMaxFuelPct) || 1;
    const fuelMax = (parseFloat(di.DriverCarFuelMaxLtr) || 0) * maxPct;

    return {
      connected: true,
      sessionUid: `${wi.SessionID || ''}-${wi.SubSessionID || ''}-${sessionNum}`,
      track: {
        id: wi.TrackID || 0,
        name: String(wi.TrackDisplayName || ''),
        config: String(wi.TrackConfigName || ''),
        length: String(wi.TrackLength || ''),
        lengthM: lengthMeters(wi.TrackLength),
        pitLimitKph: speedKph(wi.TrackPitSpeedLimit),
        pitPct: Number.isFinite(Number(di.DriverPitTrkPct)) ? Number(di.DriverPitTrkPct) : null,
      },
      session: {
        type: String(cur.SessionType || ''),
        timeRemain: num('SessionTimeRemain', -1),
        lapsRemain: lapsRemainEx >= 32767 ? null : lapsRemainEx,
        time: num('SessionTime', 0),
        flags: num('SessionFlags', 0),
        timeTotal: num('SessionTimeTotal', parseFloat(cur.SessionTime) || 0),
        lapsTotal: (() => { const n = num('SessionLapsTotal', parseInt(cur.SessionLaps, 10)); return n > 0 && n < 32767 ? n : null; })(),
      },
      playerIdx,
      car: {
        fuel: num('FuelLevel'),
        fuelMax,
        onPit: bool('OnPitRoad'),
        lap: num('Lap'),
        lapCompleted: num('LapCompleted'),
        lapDistPct: num('LapDistPct'),
        lapCurrent: num('LapCurrentLapTime', -1),
        lapLast: num('LapLastLapTime', -1),
        lapBest: num('LapBestLapTime', -1),
        deltaBest: num('LapDeltaToBestLap'),
        deltaBestRate: num('LapDeltaToBestLap_DD'),
        deltaBestOk: bool('LapDeltaToBestLap_OK'),
        deltaSession: num('LapDeltaToSessionBestLap'),
        deltaSessionRate: num('LapDeltaToSessionBestLap_DD'),
        deltaSessionOk: bool('LapDeltaToSessionBestLap_OK'),
        throttle: num('Throttle'),
        brake: num('Brake'),
        clutch: 1 - num('Clutch', 1), // iRacing: 1 = eingekuppelt → Pedalweg = 1 - Wert
        steer: num('SteeringWheelAngle'),
        steerMax: num('SteeringWheelAngleMax', 7.85),
        gear: num('Gear'),
        speed: num('Speed'),
        rpm: num('RPM'),
        abs: bool('BrakeABSactive'),
        vx: num('VelocityX'),
        vy: num('VelocityY'),
        yaw: num('Yaw'),
        onTrack: bool('IsOnTrack'),
        inGarage: bool('IsInGarage'),
        replay: bool('IsReplayPlaying'),
        engineWarnings: num('EngineWarnings'),
        latAccel: num('LatAccel'),
        longAccel: num('LongAccel'),
        incidents: num('PlayerCarMyIncidentCount'),
        tires: Object.fromEntries(['LF', 'RF', 'LR', 'RR'].map((t) => [t.toLowerCase(), {
          temp: [num(`${t}tempCL`), num(`${t}tempCM`), num(`${t}tempCR`)],
          wear: [num(`${t}wearL`, 1), num(`${t}wearM`, 1), num(`${t}wearR`, 1)],
        }])),
      },
      weather: { airTemp: num('AirTemp', NaN), trackTemp: num('TrackTempCrew', NaN) },
      drivers,
      cars,
    };
  }
}

module.exports = { IRacingSource, hexColor, VARS };
