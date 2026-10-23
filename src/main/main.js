'use strict';
// Electron-Hauptprozess: startet den Core-Prozess (Telemetrie + Server), verwaltet Control Panel,
// Tray-Icon und die transparenten Overlay-Fenster über iRacing.
//
// Verhalten:
// - Hauptfenster schliessen → Programm läuft im Hintergrund weiter (Icon im Infobereich).
// - Overlays erscheinen nur, wenn iRacing läuft und du in einer Session bist (oder im Demo-Modus).
// - «Mit Windows starten» startet das Programm unsichtbar im Hintergrund (--hidden).
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, globalShortcut, dialog, shell } = require('electron');
const { fork } = require('child_process');
const path = require('path');
const { Updater, feedUrl } = require('./updater');
const pkg = require('../../package.json');

const BASE = {
  relative: [430, 300], standings: [540, 620], fuel: [330, 230],
  inputs: [430, 150], delta: [470, 96], trackmap: [330, 330],
};
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const HIDE_DELAY = 2500; // ms – kurze Aussetzer (Ladebildschirm, Sessionwechsel) nicht flackern lassen
const STATUS_TEXT = { live: 'iRacing verbunden', demo: 'Demo läuft', waiting: 'Wartet auf iRacing' };

let core = null;
let port = 7913;
let settings = null;
let control = null;
let tray = null;
const windows = new Map();   // id → BrowserWindow
let hiddenAll = false;       // manuell ausgeblendet (Strg+Umschalt+H / Tray)
let status = 'waiting';      // vom Core: 'live' | 'demo' | 'waiting'
let overlaysVisible = false;
let hideTimer = null;
let quitting = false;
const moveTimers = new Map();
const startHidden = process.argv.includes('--hidden');
const justUpdated = process.argv.includes('--updated');
let updater = null;
let updateState = null;
let notifiedVersion = null;
let autoUpdateApplied = null;
const dbg = (...a) => { if (process.env.OM_DEBUG) console.log('[OM:main]', ...a); };

app.setAppUserModelId('ch.obristmotorsport.overlays'); // eigenes Taskleisten-Icon/Gruppierung
if (!app.requestSingleInstanceLock()) { app.exit(0); } // läuft schon → zweite Instanz sofort beenden
app.on('second-instance', () => showControl());          // erneuter Start öffnet das Hauptfenster

function sendCore(msg) { if (core && core.connected) core.send(msg); }
function patchSettings(patch) { sendCore({ type: 'settings', patch }); }

// ---------- Core-Prozess ----------

function startCore() {
  core = fork(path.join(__dirname, '..', 'core', 'index.js'), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OM_DATA_DIR: app.getPath('userData') },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  core.on('message', (msg) => {
    if (msg.type === 'ready') {
      port = msg.port;
      if (updateState) sendCore({ type: 'update', state: updateState });
      if (!control) createControl(!startHidden);
      if (!msg.sdk) console.warn('[OM] iRacing-SDK nicht verfügbar:', msg.sdkError);
    } else if (msg.type === 'settings') {
      onSettings(msg.data);
    } else if (msg.type === 'status') {
      setStatus(msg.status);
    } else if (msg.type === 'command') {
      handleCommand(msg.cmd);
    } else if (msg.type === 'error') {
      dialog.showErrorBox('OM Overlays', msg.message + '\n\nLäuft OM Overlays schon? Sonst Port in den Einstellungen ändern.');
    }
  });
  core.on('exit', (code) => {
    core = null;
    setStatus('waiting');
    if (!quitting) { console.warn('[OM] Core beendet (' + code + '), Neustart …'); setTimeout(startCore, 1000); }
  });
}

async function loadSettings() {
  const r = await fetch(`http://127.0.0.1:${port}/api/settings`);
  onSettings(await r.json());
}

function onSettings(data) {
  settings = data;
  syncWindows();
  syncAutostart();
  if (updater && autoUpdateApplied !== (settings.autoUpdate !== false)) {
    autoUpdateApplied = settings.autoUpdate !== false;
    updater.setAuto(autoUpdateApplied);
  }
  updateTray();
}

// ---------- Updates ----------

function createUpdater() {
  updater = new Updater({
    version: app.getVersion() || pkg.version,
    feed: feedUrl(pkg),
    inSession: () => status === 'live',
    onState: (s) => {
      updateState = s;
      sendCore({ type: 'update', state: s });
      updateTray();
      if (s.phase === 'available' && s.latest !== notifiedVersion) {
        notifiedVersion = s.latest;
        balloon('Update verfügbar', `OM Overlays ${s.latest} ist bereit. Installieren über das Hauptfenster oder das Symbol im Infobereich.`);
      }
    },
    // Nach dem Update im selben Zustand weiterlaufen (Hauptfenster offen oder im Hintergrund)
    restartArgs: () => ['--updated', ...(control && control.isVisible() ? [] : ['--hidden'])],
    quit: () => app.quit(),
  });
  updateState = updater.state;
}

function balloon(title, content) {
  if (tray && process.platform === 'win32') tray.displayBalloon({ iconType: 'info', title, content });
}

// ---------- Hauptfenster ----------

function createControl(show) {
  control = new BrowserWindow({
    width: 1240, height: 900, minWidth: 460,
    title: 'OM Overlays',
    backgroundColor: '#101113',
    icon: ICON,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  control.loadURL(`http://127.0.0.1:${port}/`);
  control.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  let closedEarly = false;
  if (show) control.once('ready-to-show', () => { if (!closedEarly) control.show(); });
  // Schliessen = in den Hintergrund. Beenden nur über das Tray-Menü.
  control.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    dbg('Hauptfenster geschlossen → Hintergrund');
    closedEarly = true;
    control.hide();
    backgroundHint();
  });
  control.on('closed', () => { control = null; });
  loadSettings().catch(() => {});

  if (process.env.OM_TEST_CLOSE_MS) { // nur für automatische Tests
    setTimeout(() => control && control.close(), Number(process.env.OM_TEST_CLOSE_MS));
  }
}

function showControl() {
  if (!control) { if (port && core) createControl(true); return; }
  if (control.isMinimized()) control.restore();
  control.show();
  control.focus();
}

function backgroundHint() {
  if (!settings || settings.backgroundHintShown || !tray) return;
  if (process.platform === 'win32') {
    tray.displayBalloon({
      iconType: 'info',
      title: 'OM Overlays läuft im Hintergrund',
      content: 'Die Overlays erscheinen automatisch, sobald du in iRacing in einer Session bist. Beenden über das Symbol im Infobereich.',
    });
  }
  patchSettings({ backgroundHintShown: true });
}

// ---------- Tray-Icon ----------

function createTray() {
  let img = nativeImage.createFromPath(ICON);
  if (!img.isEmpty()) img = img.resize({ width: 32, height: 32, quality: 'best' });
  tray = new Tray(img);
  tray.on('click', showControl);
  tray.on('double-click', showControl);
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const s = settings || {};
  const visibleNote = status === 'waiting' ? 'Overlays erscheinen in der Session' : (hiddenAll ? 'Overlays ausgeblendet' : 'Overlays sichtbar');
  tray.setToolTip(`OM Overlays – ${STATUS_TEXT[status] || status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `${STATUS_TEXT[status] || status} – ${visibleNote}`, enabled: false },
    { type: 'separator' },
    { label: 'Hauptfenster öffnen', click: showControl },
    { label: 'Overlays sperren', type: 'checkbox', checked: s.locked !== false, accelerator: 'CommandOrControl+Shift+L',
      click: (item) => patchSettings({ locked: item.checked }) },
    { label: 'Overlays ausblenden', type: 'checkbox', checked: hiddenAll, accelerator: 'CommandOrControl+Shift+H',
      click: () => toggleHidden() },
    { label: 'Datenquelle', submenu: [
      { label: 'iRacing', type: 'radio', checked: s.source !== 'demo', click: () => patchSettings({ source: 'auto' }) },
      { label: 'Demo', type: 'radio', checked: s.source === 'demo', click: () => patchSettings({ source: 'demo' }) },
    ] },
    { type: 'separator' },
    { label: 'Mit Windows starten', type: 'checkbox', checked: !!s.autostart,
      click: (item) => patchSettings({ autostart: item.checked }) },
    { type: 'separator' },
    updateMenuItem(),
    { type: 'separator' },
    { label: 'OM Overlays beenden', click: () => app.quit() },
  ]));
}

function updateMenuItem() {
  const u = updateState || {};
  if (u.phase === 'available') return { label: `Update auf ${u.latest} installieren`, click: () => updater.install() };
  if (u.phase === 'downloading') return { label: `Update wird geladen (${Math.round((u.progress || 0) * 100)} %)`, enabled: false };
  if (u.phase === 'ready') return { label: `Update ${u.latest} wird nach der Session installiert`, enabled: false };
  if (u.phase === 'installing') return { label: 'Update wird installiert …', enabled: false };
  return { label: `Nach Updates suchen (Version ${app.getVersion()})`, click: () => { showControl(); updater && updater.check(true); } };
}

// ---------- Autostart ----------

function syncAutostart() {
  if (!settings || process.platform !== 'win32' || !app.isPackaged) return;
  const want = !!settings.autostart;
  const opts = { path: process.execPath, args: ['--hidden'], name: 'OM Overlays' };
  if (app.getLoginItemSettings(opts).openAtLogin !== want) {
    app.setLoginItemSettings({ ...opts, openAtLogin: want });
  }
}

// ---------- Overlay-Fenster ----------

function defaultPositions() {
  const wa = screen.getPrimaryDisplay().workArea;
  const r = (x, y) => ({ x: Math.round(wa.x + x), y: Math.round(wa.y + y) });
  const W = wa.width, H = wa.height;
  return {
    standings: r(20, 20),
    relative: r(20, H - 330),
    delta: r(W / 2 - 235, 20),
    fuel: r(W - 350, 20),
    trackmap: r(W - 350, 270),
    inputs: r(W / 2 - 215, H - 170),
  };
}

function onScreen(x, y) {
  return screen.getAllDisplays().some((d) => {
    const b = d.bounds;
    return x >= b.x - 50 && y >= b.y - 50 && x < b.x + b.width - 50 && y < b.y + b.height - 50;
  });
}

// Sollen die Overlays gerade sichtbar sein?
function shouldShow() {
  return !hiddenAll && (status === 'live' || status === 'demo');
}

function setStatus(next) {
  if (next === status) return;
  if (status === 'live' && updater) updater.sessionEnded();
  dbg('status', status, '→', next);
  status = next;
  updateTray();
  applyVisibility();
}

function applyVisibility() {
  clearTimeout(hideTimer);
  if (shouldShow()) {
    setOverlaysVisible(true);
  } else if (hiddenAll) {
    setOverlaysVisible(false);
  } else {
    hideTimer = setTimeout(() => setOverlaysVisible(shouldShow()), HIDE_DELAY);
  }
}

function setOverlaysVisible(v) {
  dbg('overlays sichtbar:', v);
  overlaysVisible = v;
  for (const w of windows.values()) {
    if (w.isDestroyed() || !w.omReady) continue;
    if (v && !w.isVisible()) w.showInactive();
    else if (!v && w.isVisible()) w.hide();
  }
}

function createOverlay(id) {
  const o = settings.overlays[id];
  const [bw, bh] = BASE[id];
  let { x, y } = o;
  if (!onScreen(x, y)) ({ x, y } = defaultPositions()[id]);
  const win = new BrowserWindow({
    x, y, width: Math.round(bw * o.scale), height: Math.round(bh * o.scale),
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    skipTaskbar: true, hasShadow: false, focusable: settings.locked === false, show: false,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.loadURL(`http://127.0.0.1:${port}/overlays/${id}.html?mode=window`);
  win.on('show', () => dbg('show', id));
  win.on('hide', () => dbg('hide', id));
  win.once('ready-to-show', () => {
    win.omReady = true;
    dbg('bereit', id, 'sichtbar?', overlaysVisible, win.isVisible());
    applyLock(win);
    if (overlaysVisible) win.showInactive();
  });
  win.on('moved', () => savePosition(id, win));
  win.on('move', () => savePosition(id, win));
  win.on('closed', () => windows.delete(id));
  windows.set(id, win);
  return win;
}

function savePosition(id, win) {
  clearTimeout(moveTimers.get(id));
  moveTimers.set(id, setTimeout(() => {
    if (win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    patchSettings({ overlays: { [id]: { x, y } } });
  }, 250));
}

function applyLock(win) {
  if (win.isDestroyed()) return;
  const locked = settings.locked !== false;
  win.setIgnoreMouseEvents(locked, { forward: true });
  win.setFocusable(!locked);
}

function syncWindows() {
  if (!settings || !port) return;
  for (const [id, o] of Object.entries(settings.overlays)) {
    if (!BASE[id]) continue;
    let win = windows.get(id);
    if (!o.enabled) { if (win && !win.isDestroyed()) win.close(); continue; }
    if (!win || win.isDestroyed()) { createOverlay(id); continue; }
    const [bw, bh] = BASE[id];
    const w = Math.round(bw * o.scale), h = Math.round(bh * o.scale);
    const b = win.getBounds();
    if (Math.abs(b.width - w) > 1 || Math.abs(b.height - h) > 1 || Math.abs(b.x - o.x) > 2 || Math.abs(b.y - o.y) > 2) {
      win.setBounds({ x: o.x, y: o.y, width: w, height: h });
    }
    applyLock(win);
  }
}

function handleCommand(cmd) {
  if (cmd.cmd === 'resetPositions') {
    const def = defaultPositions();
    const patch = { overlays: {} };
    for (const id of Object.keys(BASE)) patch.overlays[id] = def[id];
    patchSettings(patch);
  } else if (cmd.cmd === 'quit') {
    app.quit();
  } else if (cmd.cmd === 'updateCheck') {
    if (updater) updater.check(true);
  } else if (cmd.cmd === 'updateInstall') {
    if (updater) updater.install();
  }
}

function toggleHidden() {
  hiddenAll = !hiddenAll;
  applyVisibility();
  updateTray();
}

// ---------- Start / Ende ----------

app.whenReady().then(() => {
  createUpdater();
  createTray();
  startCore();
  if (justUpdated) setTimeout(() => balloon('OM Overlays aktualisiert', `Version ${app.getVersion()} ist installiert.`), 1500);
  globalShortcut.register('CommandOrControl+Shift+L', () => {
    if (settings) patchSettings({ locked: !(settings.locked !== false) });
  });
  globalShortcut.register('CommandOrControl+Shift+H', toggleHidden);
});

// Alle Fenster zu heisst nicht beenden – das Programm läuft im Hintergrund weiter.
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true;
  globalShortcut.unregisterAll();
  if (core) core.kill();
  if (tray) tray.destroy();
});
