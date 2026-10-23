'use strict';
// Lokaler HTTP-Server (nur 127.0.0.1): liefert Overlays/Control-Panel aus und streamt Daten per WebSocket.
// Dieselben URLs funktionieren in den Overlay-Fenstern und als OBS-Browserquelle.
// WebSocket statt Server-Sent Events: Chromium (auch OBS) erlaubt nur 6 SSE-Verbindungen pro Server,
// bei WebSockets liegt die Grenze bei 255 – genug für alle Overlays, Vorschauen und OBS gleichzeitig.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_BACKLOG = 512 * 1024; // langsamer Client (z. B. ausgeblendete OBS-Quelle) → Frames auslassen

function wsFrame(text, opcode = 0x1) {
  const payload = Buffer.from(text);
  const n = payload.length;
  let head;
  if (n < 126) { head = Buffer.alloc(2); head[1] = n; }
  else if (n < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}

class WsClient {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.alive = true;
  }
  send(frame, droppable) {
    if (!this.alive) return;
    if (droppable && this.socket.writableLength > MAX_BACKLOG) return;
    try { this.socket.write(frame); } catch { this.alive = false; }
  }
  // Eingehende Frames: nur Ping/Close sind relevant
  onData(chunk, onClose) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 2) {
      const op = this.buf[0] & 0x0f;
      const masked = (this.buf[1] & 0x80) !== 0;
      let len = this.buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const maskOff = off;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = this.buf.subarray(off, off + len);
      if (masked) {
        const mask = this.buf.subarray(maskOff, maskOff + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
      }
      this.buf = this.buf.subarray(off + len);
      if (op === 0x8) { this.send(wsFrame('', 0x8)); this.socket.end(); onClose(); return; }
      if (op === 0x9) this.send(wsFrame(payload, 0xA));
    }
  }
}

class Server {
  constructor({ webRoot, port, getSettings, onSettings, onCommand }) {
    this.webRoot = webRoot;
    this.port = port;
    this.getSettings = getSettings;
    this.onSettings = onSettings;
    this.onCommand = onCommand;
    this.clients = new Set();
    this.lastTrack = null;
    this.lastUpdate = null;
  }

  start() {
    this.http = http.createServer((req, res) => this._handle(req, res));
    this.http.on('upgrade', (req, socket) => this._upgrade(req, socket));
    return new Promise((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.port, '127.0.0.1', () => resolve(this.port));
    });
  }

  _upgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!req.url.startsWith('/ws') || !key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    const client = new WsClient(socket);
    this.clients.add(client);
    const drop = () => { client.alive = false; this.clients.delete(client); };
    socket.on('data', (c) => client.onData(c, drop));
    socket.on('close', drop);
    socket.on('error', drop);
    client.send(wsFrame(JSON.stringify({ event: 'settings', data: this.getSettings() })));
    if (this.lastTrack) client.send(wsFrame(JSON.stringify({ event: 'track', data: { path: this.lastTrack } })));
    if (this.lastUpdate) client.send(wsFrame(JSON.stringify({ event: 'update', data: this.lastUpdate })));
  }

  broadcast(event, data) {
    if (!this.clients.size) return;
    const frame = wsFrame(JSON.stringify({ event, data }));
    const droppable = event === 'frame'; // Live-Daten dürfen ausfallen, Einstellungen nicht
    for (const c of this.clients) c.send(frame, droppable);
  }
  setUpdate(state) { this.lastUpdate = state; this.broadcast('update', state); }
  setTrack(pathPts) { this.lastTrack = pathPts; this.broadcast('track', { path: pathPts }); }

  _json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  _body(req) {
    return new Promise((resolve) => {
      let b = '';
      req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
    });
  }

  async _handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;

    if (p === '/api/settings') {
      if (req.method === 'GET') return this._json(res, 200, this.getSettings());
      if (req.method === 'POST') { const patch = await this._body(req); return this._json(res, 200, this.onSettings(patch)); }
    }
    if (p === '/api/command' && req.method === 'POST') {
      const cmd = await this._body(req);
      return this._json(res, 200, (await this.onCommand(cmd)) || { ok: true });
    }

    // statische Dateien
    let rel = p === '/' ? '/control/index.html' : p;
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(this.webRoot, decodeURIComponent(rel)));
    if (!file.startsWith(path.normalize(this.webRoot))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nicht gefunden'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }
}

module.exports = { Server, wsFrame };
