'use strict';
// Core-Prozess: Datenquelle → Engine → Server.
// Läuft als eigener Prozess (von Electron gestartet), damit das Lesen der Telemetrie
// niemals die Overlay-Fenster blockiert. Lässt sich auch allein starten: `npm run demo`.
const path = require('path');
const { Settings, activeLayout } = require('./settings');
const { Engine } = require('./engine');
const { Server } = require('./server');
const { TrackRecorder } = require('./track-recorder');
const { DemoSource } = require('./sources/demo');
const { IRacingSource } = require('./sources/iracing');

const args = process.argv.slice(2);
const dataDir = process.env.OM_DATA_DIR || path.join(__dirname, '..', '..', '.om-data');
const webRoot = path.join(__dirname, '..', '..', 'web');
const toParent = (msg) => { if (process.send) process.send(msg); };

const settings = new Settings(dataDir);
if (args.includes('--demo')) settings.update({ source: 'demo' });

const engine = new Engine();
const recorder = new TrackRecorder(dataDir);
let demo = null;
const iracing = new IRacingSource();
let status = 'waiting';
let category = null;       // zuletzt erkannte Session-Art (bleibt beim Warten erhalten)
let layoutKey = '';
// Im Auto oder in der Box? Erst nach kurzer stabiler Phase umschalten (Reset, Abschleppen, Kamerawechsel)
const CAR_STABLE_MS = 700;
let inCar = null;
let carCandidate = null;
let carSince = 0;
function updateCarState(raw, now) {
  // Im Auto = Fahrphysik läuft mit dir am Steuer und kein Replay. Alles andere (Box/Garage,
  // Replay, Zuschauen, Ladebildschirm) gilt als «in der Box».
  const next = raw ? (!!raw.car.onTrack && !raw.car.replay) : null;
  if (next === null) { if (inCar !== null) toParent({ type: 'car', inCar: null }); inCar = null; carCandidate = null; return; }
  if (next !== carCandidate) { carCandidate = next; carSince = now; }
  if (inCar === null || (next !== inCar && now - carSince >= CAR_STABLE_MS)) {
    if (inCar !== next) toParent({ type: 'car', inCar: next });
    inCar = next;
  }
}
const DEMO_TYPES = { practice: 'Practice', qualify: 'Lone Qualify', race: 'Race' };

// Aktives Spiel-Layout bestimmen und bei Änderung an Hauptprozess und Anzeigen melden
function syncLayout() {
  const s = settings.get();
  const active = activeLayout(s, category);
  const key = `${active}|${category}|${s.editLayout || ''}`;
  if (key === layoutKey) return;
  layoutKey = key;
  const info = { active, category, editing: !!s.editLayout };
  toParent({ type: 'layout', ...info });
  server.setLayout(info);
}

const server = new Server({
  webRoot,
  mediaDir: path.join(dataDir, 'media'),
  port: Number(process.env.OM_PORT) || settings.get().port || 7913,
  getSettings: () => settings.get(),
  onSettings: (patch) => settings.update(patch),
  onCommand: async (cmd) => {
    if (cmd.cmd === 'clearTrack') { recorder.clear(); return { ok: true }; }
    if (cmd.cmd === 'status') return { ok: true, status, sdk: iracing.available, sdkError: iracing.error };
    toParent({ type: 'command', cmd }); // z.B. Fenster-Aktionen → Electron
    return { ok: true };
  },
});

settings.onChange((data) => {
  server.broadcast('settings', data);
  toParent({ type: 'settings', data });
  syncLayout();
});
recorder.onPath((p) => server.setTrack(p));

process.on('message', (msg) => {
  if (msg && msg.type === 'settings') settings.update(msg.patch);
  if (msg && msg.type === 'update') server.setUpdate(msg.state); // Update-Status vom Hauptprozess
});

async function loop() {
  let last = Date.now();
  let tick = 0;
  const run = async () => {
    const now = Date.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = settings.get();
    let raw = null;

    if (s.source === 'demo') {
      if (iracing.proc) iracing.stop();
      if (!demo) demo = new DemoSource({ driverName: s.driverName, carNumber: s.carNumber });
      demo.step(dt);
      raw = demo.read();
      raw.session.type = DEMO_TYPES[s.demoSession] || 'Race';
      raw.car.onTrack = s.demoCar !== 'box';
      raw.car.inGarage = s.demoCar === 'box'; // Demo: «in der Box» = Garage (für das Garagen-Cover)
      recorder.setStatic(raw.trackPath);
    } else {
      demo = null;
      raw = iracing.read(); // startet om-telemetry.exe bei Bedarf
      if (raw) {
        recorder.setTrack(raw.track.id, raw.track.config);
        recorder.sample(raw.car, raw.session.time);
      }
    }

    const frame = engine.frame(raw, s, { recording: recorder.recording, progress: recorder.progress });
    updateCarState(raw, now);
    frame.inCar = inCar;
    frame.inGarage = raw ? !!raw.car.inGarage : null;
    if (frame.category) category = frame.category;
    syncLayout();
    if (frame.status !== status) { status = frame.status; toParent({ type: 'status', status }); }
    // 30 Hz an die Anzeigen; Rangliste und Spritdaten ändern sich langsam → nur ca. 4× pro Sekunde
    if (tick++ % 2 === 0) {
      if (frame.status !== 'waiting' && (tick % 16) > 1) { delete frame.standings; delete frame.fuel; }
      server.broadcast('frame', frame);
    }
    setTimeout(run, 16);
  };
  run();
}

(async () => {
  await iracing.init();
  try {
    const port = await server.start();
    console.log(`[OM] Server läuft: http://127.0.0.1:${port}/`);
    toParent({ type: 'ready', port, sdk: iracing.available, sdkError: iracing.error });
  } catch (e) {
    console.error('[OM] Server konnte nicht starten:', e.message);
    toParent({ type: 'error', message: `Port belegt oder nicht verfügbar: ${e.message}` });
    process.exit(1);
  }
  loop();
})();
