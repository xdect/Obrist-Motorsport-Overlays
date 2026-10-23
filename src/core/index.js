'use strict';
// Core-Prozess: Datenquelle → Engine → Server.
// Läuft als eigener Prozess (von Electron gestartet), damit das Lesen der Telemetrie
// niemals die Overlay-Fenster blockiert. Lässt sich auch allein starten: `npm run demo`.
const path = require('path');
const { Settings } = require('./settings');
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

const server = new Server({
  webRoot,
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
    if (frame.status !== status) { status = frame.status; toParent({ type: 'status', status }); }
    // 30 Hz an die Overlays
    if (tick++ % 2 === 0) server.broadcast('frame', frame);
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
