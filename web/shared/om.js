// Gemeinsame Overlay-Logik: Einstellungen, Formatierung, Kopfzeile. Daten kommen über link.js (WebSocket).
//
// Woher ein Overlay seine Einstellungen nimmt, steht in der Adresse:
//   ?mode=window                         Fenster über iRacing → aktives Spiel-Layout
//   ?mode=preview&layout=<id>            Vorschau im Hauptfenster → dieses Layout
//   ?stream=<id>&widget=<id>[&mode=preview]  Element eines Stream-Overlays
//   (ohne Angaben)                       einzelne OBS-Quelle → aktives Spiel-Layout
(function () {
  const params = new URLSearchParams(location.search);
  const m = params.get('mode');
  const mode = m === 'window' || m === 'preview' ? m : 'obs';
  const overlayId = document.body.dataset.overlay;
  const streamId = params.get('stream');
  const widgetId = params.get('widget');
  document.body.classList.add(mode);
  if (streamId) document.body.classList.add('in-stream');

  const OM = {
    mode, overlayId, params,
    settings: null,
    layoutInfo: null,  // { active, category, editing }
    frame: null,
    track: null,
    _slow: {},         // Rangliste/Sprit kommen seltener – letzte Werte merken

    // Einstellungen dieses Overlays (inkl. Grundwerte)
    cfg() {
      const S = this.settings;
      const base = (OMDefaults.OPTIONS[overlayId] && { ...OMDefaults.OPTIONS[overlayId] }) || {};
      if (!S) return base;
      if (streamId && widgetId) {
        const w = S.streams && S.streams[streamId] && S.streams[streamId].widgets[widgetId];
        return w ? { ...base, ...w.options, opacity: w.opacity, scale: 1, enabled: true } : base;
      }
      const lid = params.get('layout') || (this.layoutInfo && this.layoutInfo.active) || Object.keys(S.layouts || {})[0];
      const l = S.layouts && S.layouts[lid];
      return (l && l.overlays[overlayId]) || base;
    },

    connect(handlers) {
      const refresh = () => {
        if (!this.settings) return;
        this._applySettings();
        handlers.onSettings && handlers.onSettings(this.settings);
      };
      OMLink.connect({
        settings: (data) => { this.settings = data; refresh(); },
        layout: (info) => { this.layoutInfo = info; refresh(); },
        track: (data) => {
          this.track = data.path;
          handlers.onTrack && handlers.onTrack(this.track);
        },
        frame: (f) => {
          if (!this.settings) return;
          for (const k of ['standings', 'fuel']) {
            if (f[k] !== undefined) this._slow[k] = f[k];
            else if (f.status !== 'waiting') f[k] = this._slow[k];
          }
          this.frame = f;
          const waiting = f.status === 'waiting';
          document.body.classList.toggle('waiting', waiting);
          handlers.onFrame && handlers.onFrame(f, waiting);
        },
        close: () => document.body.classList.add('waiting'),
      });
    },

    _applySettings() {
      const c = this.cfg();
      const root = document.documentElement.style;
      // Einzelne OBS-Quelle: Deckkraft/Skalierung per URL übersteuerbar (?opacity=0.8&scale=1.2)
      const op = params.has('opacity') ? Number(params.get('opacity')) : c.opacity;
      if (op !== undefined) root.setProperty('--panel-alpha', String(op));
      const scale = params.has('scale') ? Number(params.get('scale')) : (mode === 'window' ? c.scale : 1);
      document.body.style.zoom = String(scale || 1);
      document.body.classList.toggle('edit', mode === 'window' && this.settings.locked === false);
    },

    header(el, title, metaHtml) {
      const num = (this.settings && this.settings.carNumber) || '13';
      el.innerHTML = `<div class="om-tab"><small>OM</small>${esc(num)}</div><div class="om-title">${esc(title)}</div><div class="om-meta">${metaHtml || ''}</div>`;
    },
  };

  // Formatierung
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  OM.esc = esc;
  OM.lap = (s) => {
    if (s === null || s === undefined || !(s > 0)) return '–';
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m > 0 ? `${m}:${r.toFixed(3).padStart(6, '0')}` : r.toFixed(3);
  };
  OM.gap = (s, digits = 1) => {
    if (s === null || s === undefined || !Number.isFinite(s)) return '';
    const v = Math.abs(s).toFixed(digits);
    return s > 0 ? `-${v}` : `+${v}`; // iRacing-Konvention: Auto vor dir = negativ
  };
  OM.signed = (s, digits = 2) => (s >= 0 ? '+' : '−') + Math.abs(s).toFixed(digits);
  OM.clock = (s) => {
    if (!(s >= 0)) return '';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };
  OM.ir = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || ''));
  OM.waitingText = 'Wartet auf iRacing. Sobald du in einer Session sitzt, erscheinen hier die Daten.';

  window.OM = OM;
})();
