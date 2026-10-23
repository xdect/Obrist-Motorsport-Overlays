'use strict';
// Automatische Updates über GitHub Releases.
//
// Jedes Release enthält neben der Setup-.exe eine Datei latest.json:
//   { "version": "1.2.0", "url": "https://github.com/…/OM-Overlays-Setup-1.2.0.exe",
//     "sha256": "…", "size": 118000000, "notes": "…", "date": "2026-10-24" }
// Über https://github.com/<repo>/releases/latest/download/latest.json ist immer die neueste erreichbar.
//
// Ablauf: prüfen → (Nutzer klickt «Installieren») → herunterladen + Prüfsumme → falls in Session:
// warten → Setup im Updatemodus starten → App beendet sich, Setup installiert und startet neu.
const { app, net } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHECK_EVERY = 6 * 60 * 60 * 1000; // 6 Stunden
const FIRST_CHECK = 20 * 1000;          // 20 s nach dem Start

function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isNewer(remote, local) {
  const a = parseVersion(remote), b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

function feedUrl(pkg) {
  if (process.env.OM_UPDATE_FEED) return process.env.OM_UPDATE_FEED;
  const repo = pkg.updates && pkg.updates.github;
  return repo ? `https://github.com/${repo}/releases/latest/download/latest.json` : null;
}

class Updater {
  /**
   * @param {object} o
   * @param {string} o.version          aktuelle Version
   * @param {string|null} o.feed        URL zu latest.json
   * @param {() => boolean} o.inSession läuft gerade eine iRacing-Session?
   * @param {(state) => void} o.onState Statusänderung (für Hauptfenster/Tray)
   * @param {() => string[]} o.restartArgs Argumente für den Neustart nach dem Update
   * @param {() => void} o.quit         App beenden
   */
  constructor(o) {
    Object.assign(this, o);
    this.state = { phase: 'idle', current: o.version, latest: null, notes: '', progress: 0, error: null, checkedAt: null };
    this.manifest = null;
    this.file = null;
    this.timer = null;
    this.waitingForSession = false;
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }

  start(enabled) {
    this.setAuto(enabled);
  }

  setAuto(enabled) {
    clearTimeout(this.timer);
    clearInterval(this.interval);
    if (!enabled || !this.feed) return;
    this.timer = setTimeout(() => this.check(false), FIRST_CHECK);
    this.interval = setInterval(() => this.check(false), CHECK_EVERY);
  }

  async check(manual) {
    if (!this.feed) {
      this._set({ phase: 'error', error: 'Keine Update-Quelle eingerichtet.' });
      return;
    }
    if (['downloading', 'ready', 'installing'].includes(this.state.phase)) return;
    this._set({ phase: 'checking', error: null });
    try {
      const res = await net.fetch(`${this.feed}${this.feed.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
      if (res.status === 404) throw new Error('Noch kein Release veröffentlicht.');
      if (!res.ok) throw new Error(`Update-Server antwortet mit ${res.status}.`);
      const m = await res.json();
      if (!m || !parseVersion(m.version) || !m.url) throw new Error('Update-Information ist unvollständig.');
      this.manifest = m;
      if (isNewer(m.version, this.version)) {
        this._set({ phase: 'available', latest: m.version, notes: String(m.notes || ''), checkedAt: Date.now() });
      } else {
        this._set({ phase: 'uptodate', latest: m.version, notes: '', checkedAt: Date.now() });
      }
    } catch (e) {
      // Automatische Prüfung ohne Netz: still bleiben, nur bei manueller Prüfung melden
      this._set({ phase: manual ? 'error' : 'idle', error: manual ? this._msg(e) : null, checkedAt: Date.now() });
    }
  }

  _msg(e) {
    const t = String(e && e.message || e);
    if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/i.test(t)) return 'Keine Internetverbindung.';
    return t;
  }

  // Vom Nutzer ausgelöst: herunterladen, prüfen, installieren (ggf. nach der Session)
  async install() {
    if (!this.manifest || !isNewer(this.manifest.version, this.version)) return;
    if (this.state.phase === 'downloading' || this.state.phase === 'installing') return;
    try {
      if (!this.file) await this._download();
    } catch (e) {
      this.file = null;
      this._set({ phase: 'error', error: 'Download fehlgeschlagen: ' + this._msg(e) });
      return;
    }
    this._installWhenFree();
  }

  _installWhenFree() {
    if (this.inSession()) {
      this.waitingForSession = true;
      this._set({ phase: 'ready', error: null });
      return; // sessionEnded() ruft später wieder auf
    }
    this.waitingForSession = false;
    this._runInstaller();
  }

  // Wird vom Hauptprozess aufgerufen, wenn die iRacing-Session endet.
  sessionEnded() {
    if (this.waitingForSession && this.file) setTimeout(() => this._installWhenFree(), 3000);
  }

  async _download() {
    const m = this.manifest;
    this._set({ phase: 'downloading', progress: 0, error: null });
    const dir = path.join(os.tmpdir(), 'om-overlays-update');
    fs.mkdirSync(dir, { recursive: true });
    const name = path.basename(new URL(m.url).pathname) || `OM-Overlays-Setup-${m.version}.exe`;
    const target = path.join(dir, name);
    const part = target + '.part';

    const res = await net.fetch(m.url, { cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error(`Server antwortet mit ${res.status}`);
    const total = Number(res.headers.get('content-length')) || Number(m.size) || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    let got = 0, lastReport = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        hash.update(buf);
        got += buf.length;
        if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
        if (total && Date.now() - lastReport > 250) {
          lastReport = Date.now();
          this._set({ progress: Math.min(0.99, got / total) });
        }
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    const digest = hash.digest('hex');
    if (m.sha256 && digest.toLowerCase() !== String(m.sha256).toLowerCase()) {
      fs.rmSync(part, { force: true });
      throw new Error('Prüfsumme stimmt nicht – Datei beschädigt oder verändert.');
    }
    if (m.size && got !== Number(m.size)) {
      fs.rmSync(part, { force: true });
      throw new Error('Datei unvollständig.');
    }
    fs.rmSync(target, { force: true });
    fs.renameSync(part, target);
    this.file = target;
    this._set({ progress: 1 });
  }

  _runInstaller() {
    this._set({ phase: 'installing', error: null });
    const args = ['/update', '--', ...this.restartArgs()];
    try {
      // OM_TEST_INSTALLER_SHELL: nur für automatische Tests unter Linux
      const child = process.env.OM_TEST_INSTALLER_SHELL
        ? spawn('sh', [this.file, ...args], { detached: true, stdio: 'ignore' })
        : spawn(this.file, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', (e) => this._set({ phase: 'error', error: 'Setup konnte nicht gestartet werden: ' + e.message }));
      child.unref();
    } catch (e) {
      this._set({ phase: 'error', error: 'Setup konnte nicht gestartet werden: ' + e.message });
      return;
    }
    setTimeout(() => this.quit(), 800); // Setup übernimmt, App macht Platz
  }
}

module.exports = { Updater, isNewer, parseVersion, feedUrl };
