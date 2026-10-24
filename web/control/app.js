// Hauptfenster von OM Overlays – aufgebaut wie RaceLab: Kopfleiste mit Bereichen, Seitenleiste,
// Kartenraster mit Live-Vorschau, Detailseite je Overlay und Fussleiste mit Layout, Sperre und Datenquelle.
(function () {
  const D = OMDefaults;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const origin = location.origin;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (n) => `<svg class="i"><use href="#i-${n}"/></svg>`;
  const wsize = (w) => { const [a, b] = D.baseSize(w.type, w.options); return { w: a, h: b }; }; // Stream-Element
  const INFO = {
    relative:  'Fahrer direkt vor und hinter dir auf der Strecke, mit Abstand in Sekunden.',
    standings: 'Rangliste mit Abstand, letzter und bester Runde.',
    fuel:      'Spritrechner: Boxenfenster, Verbrauch Ø/Max/Min, Tankmenge und Rest im Ziel.',
    inputs:    'Gas, Bremse, Kupplung und Lenkung als Verlauf, dazu Gang und Tempo.',
    delta:     'Delta zur Bestzeit mit Rundenprognose.',
    trackmap:  'Alle Autos live auf der Strecke, mit Kurvennummern. Karten für alle iRacing-Strecken sind hinterlegt.',
    flags:     'Aktuelle Flagge mit Meldung, zum Beispiel Gelb, Blau, Safety Car oder letzte Runde.',
    digiflag:  'Grosse LED-Flaggentafel wie an der Strecke. Erscheint nur, wenn eine Flagge aktiv ist.',
    timer:     'Verbleibende Zeit oder Runden der Session mit Fortschrittsbalken.',
    datablock: 'Ein einzelner Wert deiner Wahl, zum Beispiel Rundenzeit, Tempo oder Streckentemperatur.',
    pithelper: 'Boxengasse: Begrenzer, Tempo zum Limit, Distanz zum Boxenplatz und Reifenwerte.',
    gmeter:    'Längs- und Querkräfte mit Traktionskreis deiner Session.',
    cover:     'Standbild über dem ganzen Stream, solange du in der Garage bist.',
  };
  // Reihenfolge und Kartengrösse im Raster: breite Overlays bekommen breite Karten
  const ORDER = ['fuel', 'relative', 'pithelper', 'gmeter', 'trackmap', 'standings', 'inputs', 'digiflag', 'timer', 'datablock', 'delta', 'flags'];
  const WIDE = new Set(['fuel', 'relative', 'standings', 'inputs', 'delta', 'flags']);
  const NEW = new Set(['fuel', 'pithelper', 'gmeter', 'flags', 'digiflag', 'timer', 'datablock', 'cover']);
  const SCENE = { fuel: 'dusk', relative: 'steel', pithelper: 'pit', gmeter: 'night', trackmap: 'dawn', standings: 'dusk',
    inputs: 'night', digiflag: 'steel', timer: 'dawn', datablock: 'pit', delta: 'steel', flags: 'dusk', cover: 'night' };
  const STATUS = {
    live: 'iRacing verbunden',
    demo: 'Demo läuft',
    waiting: 'Wartet auf iRacing',
  };

  let S = null;              // Einstellungen
  let layoutInfo = null;     // { active, category, editing } vom Core
  let lastStatus = '';
  let lastCar = undefined;
  const ui = { view: 'home', detail: null, filter: '', layout: null, stream: null, widget: null };
  let renderedLayout = null; // für welches Layout das Raster gebaut ist
  let renderedDetail = '';
  let renderedInspector = '';
  try { const v = localStorage.getItem('om.view'); if (v) ui.view = v; } catch { /* egal */ }

  // ---------- Server ----------
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800); }
  async function patch(p) {
    const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    S = await r.json();
    refresh();
  }
  const command = (cmd) => fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const debounced = new Map();
  function patchSoon(key, p, ms = 250) {
    clearTimeout(debounced.get(key));
    debounced.set(key, setTimeout(() => patch(p), ms));
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Adresse kopiert'); } catch { toast(text); }
  }

  // ---------- Optionen je Overlay-Typ (Detailseite und Stream-Inspektor) ----------
  function showHtml(o, type) {
    if (type === 'cover') return '';
    return `<div class="opt full"><span>Sichtbar</span><select data-k="show">${Object.entries(D.SHOW).map(([k, l]) =>
      `<option value="${k}" ${(o.show || 'both') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  }
  function optsHtml(type, o) { return showHtml(o, type) + typeOptsHtml(type, o); }
  function typeOptsHtml(type, o) {
    switch (type) {
      case 'relative': return `
        <div class="opt"><span>Autos vor dir <output>${o.carsAhead}</output></span><input type="range" min="1" max="8" value="${o.carsAhead}" data-k="carsAhead"></div>
        <div class="opt"><span>Autos hinter dir <output>${o.carsBehind}</output></span><input type="range" min="1" max="8" value="${o.carsBehind}" data-k="carsBehind"></div>
        <div class="opt full"><label class="chk"><input type="checkbox" data-k="showIRating" ${o.showIRating !== false ? 'checked' : ''}> iRating und Lizenz zeigen</label></div>`;
      case 'standings': return `
        <div class="opt"><span>Zeilen <output>${o.rows}</output></span><input type="range" min="6" max="30" value="${o.rows}" data-k="rows"></div>
        <div class="opt"><span>Anzeigen</span><select data-k="classFilter"><option value="mine" ${o.classFilter === 'mine' ? 'selected' : ''}>Nur meine Klasse</option><option value="all" ${o.classFilter === 'all' ? 'selected' : ''}>Alle Klassen</option></select></div>`;
      case 'fuel': return `
        <div class="opt"><span>Reserve <output>${o.marginLaps}</output> Rd.</span><input type="range" min="0" max="2" step="0.25" value="${o.marginLaps}" data-k="marginLaps"></div>
        <div class="opt"><span>Durchschnitt über <output>${o.avgLaps}</output> Rd.</span><input type="range" min="1" max="10" value="${o.avgLaps}" data-k="avgLaps"></div>`;
      case 'inputs': return `
        <div class="opt full"><span>Verlauf <output>${o.traceSeconds}</output> s</span><input type="range" min="2" max="15" value="${o.traceSeconds}" data-k="traceSeconds"></div>`;
      case 'delta': return `
        <div class="opt full"><span>Vergleich mit</span><select data-k="reference"><option value="best" ${o.reference === 'best' ? 'selected' : ''}>Meiner Bestzeit</option><option value="session" ${o.reference === 'session' ? 'selected' : ''}>Session-Bestzeit</option></select></div>`;
      case 'digiflag': return `
        <div class="opt full"><label class="chk"><input type="checkbox" data-k="showGreen" ${o.showGreen !== false ? 'checked' : ''}> Grüne Flagge beim Start zeigen</label></div>`;
      case 'timer': return `
        <div class="opt full"><span>Anzeigen</span><select data-k="mode">${[['auto', 'Automatisch (Zeit oder Runden)'], ['time', 'Restzeit'], ['laps', 'Runden']].map(([k, l]) => `<option value="${k}" ${o.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
      case 'datablock': return `
        <div class="opt full"><span>Wert</span><select data-k="metric">${Object.entries(D.METRICS).map(([k, l]) => `<option value="${k}" ${o.metric === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="opt full"><label class="chk"><input type="checkbox" data-k="showLabel" ${o.showLabel !== false ? 'checked' : ''}> Bezeichnung zeigen</label></div>`;
      case 'pithelper': return `
        <div class="opt full"><label class="chk"><input type="checkbox" data-k="onlyPitLane" ${o.onlyPitLane !== false ? 'checked' : ''}> Nur in der Boxengasse zeigen</label></div>`;
      case 'gmeter': return `
        <div class="opt full"><span>Skala bis <output>${o.maxG}</output> G</span><input type="range" min="1" max="6" step="0.5" value="${o.maxG}" data-k="maxG"></div>`;
      case 'cover': return `
        <div class="opt full"><span>Zeigen</span><select data-k="trigger"><option value="garage" ${o.trigger !== 'box' ? 'selected' : ''}>Nur in der Garage</option><option value="box" ${o.trigger === 'box' ? 'selected' : ''}>Immer, wenn ich nicht im Auto sitze</option></select></div>
        <div class="opt full"><span>Bild</span><span class="hint">${o.image ? 'Eigenes Bild' : 'OM-Standardbild (Akzentfarbe und #-Nummer)'}</span>
          <div class="row-acts" style="margin-top:4px"><button class="btn" data-act="coverUpload">Eigenes Bild wählen …</button>${o.image ? '<button class="btn" data-act="coverReset">Standardbild</button>' : ''}</div></div>`;
      // trackmap: eigenes Menü in web/shared/schema.js
    }
    return '';
  }
  const inputValue = (el) => {
    if (el.dataset.force !== undefined) { const v = el.dataset.force; delete el.dataset.force; return v; }
    return el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value;
  };
  const fmtOut = (el, v) => (el.dataset.pct ? Math.round(v * 100) + ' %' : el.dataset.unit ? `${v} ${el.dataset.unit}` : String(v));
  function showOutput(el, v) {
    const box = el.closest('.f') || el.parentElement;
    const out = box && box.querySelector('output');
    if (!out) return;
    if (el.closest('.f')) out.textContent = fmtOut(el, v);
    else out.textContent = (el.dataset.k === 'scale' || el.dataset.k === 'opacity') ? Math.round(v * 100) : v;
  }

  // ---------- Einstellungs-Menü (aufklappbare Bereiche wie bei RaceLab) ----------
  let accOpen = new Set();
  try { accOpen = new Set(JSON.parse(localStorage.getItem('om.acc') || '[]')); } catch { /* egal */ }
  const saveAcc = () => { try { localStorage.setItem('om.acc', JSON.stringify([...accOpen])); } catch { /* egal */ } };
  const accentHex = () => (getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#C8A24C');
  const toHex = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : '#888888');

  function fieldHtml(f, o, type, ctx) {
    const v = o[f.k] !== undefined ? o[f.k] : f.def;
    const lbl = esc(f.label || '');
    const hint = f.hint ? `<p class="fh">${esc(f.hint)}</p>` : '';
    const wrap = (inner, cls = '') => `<div class="f ${cls}" data-label="${esc((f.label || '') + ' ' + (f.hint || '')).toLowerCase()}">${inner}${hint}</div>`;
    switch (f.type) {
      case 'range': {
        const val = Number(v);
        return wrap(`<div class="fl"><span>${lbl}</span><output>${f.pct ? Math.round(val * 100) + ' %' : f.unit ? `${val} ${f.unit}` : val}</output></div>
          <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${val}" data-k="${f.k}" ${f.pct ? 'data-pct="1"' : ''} ${f.unit ? `data-unit="${esc(f.unit)}"` : ''} aria-label="${lbl}">`);
      }
      case 'toggle': {
        const on = v !== false && v !== undefined ? !!v : false;
        return wrap(`<span class="fl1">${lbl}</span><div class="onoff" role="group" aria-label="${lbl}">
          <button data-set="${f.k}" data-v="1" aria-pressed="${on}">ON</button><button data-set="${f.k}" data-v="0" aria-pressed="${!on}">OFF</button></div>
          <input type="checkbox" data-k="${f.k}" ${on ? 'checked' : ''} hidden>`, 'row');
      }
      case 'seg':
        return wrap(`<div class="fl"><span>${lbl}</span></div><div class="segf" role="group" aria-label="${lbl}">${f.options.map(([k, l]) =>
          `<button data-set="${f.k}" data-v="${esc(k)}" aria-pressed="${v === k}">${esc(l)}</button>`).join('')}</div>
          <select data-k="${f.k}" hidden>${f.options.map(([k]) => `<option value="${esc(k)}" ${v === k ? 'selected' : ''}></option>`).join('')}</select>`);
      case 'select':
        return wrap(`<div class="fl"><span>${lbl}</span></div><select data-k="${f.k}" aria-label="${lbl}">${f.options.map(([k, l]) =>
          `<option value="${esc(k)}" ${v === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
      case 'color': {
        const isAccent = f.accent && !v;
        return wrap(`<span class="fl1">${lbl}</span><div class="colf">
          ${f.accent ? `<button data-accent="${f.k}" aria-pressed="${isAccent}" title="Akzentfarbe verwenden">Akzent</button>` : ''}
          <input type="color" data-k="${f.k}" value="${isAccent ? toHex(accentHex()) : toHex(v)}" aria-label="${lbl}"></div>`, 'row');
      }
      case 'number':
        return wrap(`<span class="fl1">${lbl}</span><div class="numf"><input type="number" min="${f.min}" max="${f.max}" step="1" value="${Number(v) || ''}" data-k="${f.k}" aria-label="${lbl}"><span>${esc(f.unit || '')}</span></div>`, 'row');
      case 'text':
        return wrap(`<div class="fl"><span>${lbl}</span></div><input type="text" data-k="${f.k}" value="${esc(v || '')}" placeholder="${esc(f.placeholder || '')}" aria-label="${lbl}">`);
      case 'hotkey':
        return wrap(`<span class="fl1">${lbl}</span><input type="text" class="hotkey" readonly data-k="${f.k}" data-hotkey="1" value="${esc(prettyKey(v))}" data-raw="${esc(v || '')}" placeholder="Nicht belegt" aria-label="${lbl}">`, 'row');
      case 'html':
        if (f.html === 'typeOptions') {
          const inner = typeOptsHtml(type, o);
          return inner ? `<div class="f" data-label="einstellungen optionen"><div class="opts">${inner}</div></div>` : '<p class="fh">Keine weiteren Einstellungen.</p>';
        }
        if (f.html === 'browser') {
          const url = `${origin}/overlays/${type}.html`;
          return `<div class="f" data-label="browser obs adresse url">
            <p class="fh" style="margin:0 0 6px">Als einzelne Browserquelle in OBS (Hintergrund durchsichtig). Ganze Szenen baust du unter <b>Stream</b>.</p>
            <div class="obs"><code title="${url}">${url}</code></div>
            <div class="row-acts" style="margin-top:8px"><button class="btn" data-copy="${url}">${icon('copy')}Kopieren</button>
            <a class="btn" href="${url}" target="_blank" rel="noopener">${icon('stream')}Im Browser öffnen</a></div></div>`;
        }
        return '';
    }
    return '';
  }
  // ctx: 'game' (Spiel-Layout) oder 'stream' (Element einer Stream-Szene)
  function accHtml(type, o, ctx) {
    const secs = OMSchema.sections(type).filter((x) => ctx === 'game' || !x.game);
    return `<label class="acc-filter">${icon('search')}<input type="search" placeholder="Tippen, um Einstellungen zu filtern …" aria-label="Einstellungen filtern"></label>
      <div class="acc">${secs.map((sec, i) => {
        const id = `${type}:${sec.id}`;
        const open = accOpen.has(id) || (!accOpen.has('!' + id) && (sec.open || (type === 'trackmap' && sec.id === 'track')));
        return `<section class="acc-s ${open ? 'open' : ''}" data-acc="${id}">
          <button class="acc-h" aria-expanded="${open}"><span>${esc(sec.title)}</span><i></i></button>
          <div class="acc-b">${sec.fields.map((f) => fieldHtml(f, o, type, ctx)).join('')}</div></section>`;
      }).join('')}</div>`;
  }
  function prettyKey(acc) {
    return String(acc || '').replace('CommandOrControl', 'Strg').replace('Shift', 'Umschalt').replace(/\+/g, ' + ');
  }
  // Tastenkombination → Electron-Accelerator
  function accelerator(e) {
    const k = e.key;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
    let key = null;
    if (/^F\d{1,2}$/.test(k)) key = k;
    else if (/^[a-z0-9]$/i.test(k)) key = k.toUpperCase();
    else if (/^Numpad\d$/.test(e.code)) key = 'num' + e.code.slice(6);
    else key = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert' }[k] || null;
    if (!key) return null;
    const mods = [e.ctrlKey && 'CommandOrControl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
    if (!mods.length && !/^F\d/.test(key)) return null; // einzelne Buchstaben würden beim Fahren stören
    return [...mods, key].join('+');
  }
  const fire = (el) => el.dispatchEvent(new Event('input', { bubbles: true }));
  // Klicks im Menü: Auf-/Zuklappen, ON/OFF, Segmente, Akzentfarbe
  document.addEventListener('click', (e) => {
    const h = e.target.closest('.acc-h');
    if (h) {
      const sec = h.parentElement, id = sec.dataset.acc;
      const open = !sec.classList.contains('open');
      sec.classList.toggle('open', open);
      h.setAttribute('aria-expanded', String(open));
      accOpen.delete(id); accOpen.delete('!' + id);
      accOpen.add(open ? id : '!' + id);
      saveAcc();
      return;
    }
    const b = e.target.closest('[data-set]');
    if (b) {
      const f = b.closest('.f'), inp = f.querySelector(`[data-k="${b.dataset.set}"]`);
      if (inp.type === 'checkbox') inp.checked = b.dataset.v === '1'; else inp.value = b.dataset.v;
      $$('[data-set]', f).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      fire(inp);
      return;
    }
    const a = e.target.closest('[data-accent]');
    if (a) {
      const inp = a.parentElement.querySelector('input[type=color]');
      inp.dataset.force = '';
      inp.value = toHex(accentHex());
      a.setAttribute('aria-pressed', 'true');
      fire(inp);
    }
  });
  document.addEventListener('input', (e) => {
    // eigene Farbe gewählt → «Akzent» nicht mehr aktiv
    if (e.target.type === 'color' && e.target.dataset.force === undefined) {
      const a = e.target.parentElement.querySelector('[data-accent]');
      if (a) a.setAttribute('aria-pressed', 'false');
    }
    const fl = e.target.closest('.acc-filter');
    if (fl) filterAcc(fl.parentElement, e.target.value);
  }, true);
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.hotkey) return;
    if (e.key === 'Tab') return;
    e.preventDefault();
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Escape') { el.value = ''; el.dataset.force = ''; fire(el); return; }
    const acc = accelerator(e);
    if (!acc) return;
    el.value = prettyKey(acc);
    el.dataset.force = acc;
    fire(el);
  });
  function filterAcc(box, q) {
    q = String(q || '').trim().toLowerCase();
    $$('.acc-s', box).forEach((sec) => {
      const title = $('.acc-h span', sec).textContent.toLowerCase();
      let any = false;
      $$('.f', sec).forEach((f) => {
        const hit = !q || title.includes(q) || (f.dataset.label || '').includes(q);
        f.hidden = !hit; any = any || hit;
      });
      sec.hidden = !!q && !any;
      sec.classList.toggle('force', !!q && any);
    });
  }


  // ---------- Bereiche ----------
  function showView(v) {
    ui.view = v;
    try { localStorage.setItem('om.view', v); } catch { /* egal */ }
    $$('.nav [data-view]').forEach((b) => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $$('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== v; });
    $('#body').classList.toggle('noside', !['overlays', 'stream'].includes(v));
    $('#main').scrollTop = 0;
    if (!S) return;
    renderSide();
    if (v === 'colors') renderColors();
    if (v === 'stream') requestAnimationFrame(fitStage);
    if (v === 'overlays') requestAnimationFrame(() => { fitPreviews(); fitDetail(); });
  }
  $$('.nav [data-view]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.view === 'overlays' && ui.view === 'overlays') openDetail(null);
    showView(b.dataset.view);
  }));
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) showView(b.dataset.go); });

  // ---------- Seitenleiste ----------
  const layoutIds = () => Object.keys(S.layouts);
  const sessionsOf = (id) => Object.keys(D.SESSIONS).filter((k) => S.gameAssign[k] === id).map((k) => D.SESSIONS[k]);
  const gameOrder = () => ORDER.filter((t) => S.layouts[ui.layout].overlays[t]).concat(D.gameTypes().filter((t) => !ORDER.includes(t)));
  const matches = (t) => !ui.filter || (D.TYPES[t].title + ' ' + INFO[t]).toLowerCase().includes(ui.filter);

  function renderSide() {
    const side = $('#side');
    if (ui.view === 'overlays') {
      const L = S.layouts[ui.layout];
      const types = D.gameTypes().slice().sort((a, b) => D.TYPES[a].title.localeCompare(D.TYPES[b].title, 'de'));
      side.innerHTML = `
        <div class="side-head"><span class="tab">${icon('layers')}OVERLAYS</span><span class="sub" title="${esc(L.name)}">${esc(L.name)}</span></div>
        <ul class="slist">${types.filter(matches).map((t) => `<li><button data-open="${t}" aria-current="${ui.detail === t}">${icon(t)}<span class="lbl">${esc(D.TYPES[t].title)}</span><i class="dot ${L.overlays[t].enabled ? 'on' : ''}" title="${L.overlays[t].enabled ? 'An' : 'Aus'}"></i></button></li>`).join('')}</ul>
        <h4>Layouts</h4>
        <ul class="slist">${layoutIds().map((id) => {
          const tags = sessionsOf(id);
          return `<li><button data-layout="${id}" aria-current="${id === ui.layout}">${icon('layers')}<span class="lbl">${esc(S.layouts[id].name)}${tags.length ? `<small>${tags.join(', ')}</small>` : ''}</span></button></li>`;
        }).join('')}<li><button class="add" data-act="newLayout">${icon('plus')}<span class="lbl">Neues Layout</span></button></li></ul>`;
    } else if (ui.view === 'stream') {
      const ids = Object.keys(S.streams);
      side.innerHTML = `
        <div class="side-head"><span class="tab">${icon('stream')}STREAM</span><span class="sub">für OBS</span></div>
        <ul class="slist">${ids.map((id) => `<li><button data-stream="${id}" aria-current="${id === ui.stream}">${icon('stream')}<span class="lbl">${esc(S.streams[id].name)}</span><span class="meta">${S.streams[id].width}×${S.streams[id].height}</span></button></li>`).join('')}
          <li><button class="add" data-act="newStream">${icon('plus')}<span class="lbl">Neues Stream-Overlay</span></button></li></ul>
        ${S.streams[ui.stream] ? `<h4>Element hinzufügen</h4>
        <ul class="slist">${Object.keys(D.TYPES).map((t) => `<li><button data-add="${t}" title="${esc(INFO[t])}">${icon(t)}<span class="lbl">${esc(D.TYPES[t].title)}</span>${icon('plus')}</button></li>`).join('')}</ul>` : ''}`;
    } else side.innerHTML = '';
  }
  $('#side').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.open) { openDetail(b.dataset.open); return; }
    if (b.dataset.layout) { selectLayout(b.dataset.layout); return; }
    if (b.dataset.act === 'newLayout') { newLayout(); return; }
    if (b.dataset.stream) { ui.stream = b.dataset.stream; ui.widget = null; refresh(); }
  });

  // ---------- Fussleiste ----------
  function renderBottom() {
    $$('[data-source]').forEach((b) => b.setAttribute('aria-pressed', String(S.source === b.dataset.source)));
    $('#demoSession').hidden = S.source !== 'demo';
    $('#demoSession').value = S.demoSession;
    $('#demoCar').hidden = S.source !== 'demo';
    $('#demoCar').value = S.demoCar;
    $('#lockOn').setAttribute('aria-pressed', String(!!S.locked));
    $('#lockOff').setAttribute('aria-pressed', String(!S.locked));
    const sel = $('#layoutSel');
    if (document.activeElement !== sel) {
      sel.innerHTML = layoutIds().map((id) => `<option value="${id}">${esc(S.layouts[id].name)}</option>`).join('');
      sel.value = S.editLayout || ui.layout;
    }
    const go = $('#posBtn');
    go.classList.toggle('done', !!S.editLayout);
    go.innerHTML = S.editLayout ? `${icon('check')}<span>Fertig positioniert</span>` : `${icon('move')}<span>Positionieren</span>`;
    go.title = S.editLayout ? 'Positionen übernehmen und Overlays sperren' : 'Layout auf dem Bildschirm anzeigen, um die Overlays zu verschieben';
    $('#activeCount').textContent = Object.values(S.layouts[ui.layout].overlays).filter((o) => o.enabled).length;
    $('#brandNum').textContent = S.carNumber || '13';
    $('#autostart').checked = !!S.autostart;
    $('#autoUpdate').checked = S.autoUpdate !== false;
    const bar = $('#positioning');
    bar.hidden = !S.editLayout;
    if (S.editLayout) {
      const en = S.layouts[S.editLayout];
      $('#positioningText').textContent = `«${en ? en.name : ''}» wird jetzt auf dem Bildschirm angezeigt. Ziehe die Overlays an ihren Platz; am Griff rechts unten änderst du die Grösse.`;
    }
  }
  $$('[data-source]').forEach((b) => b.addEventListener('click', () => patch({ source: b.dataset.source })));
  $('#demoSession').addEventListener('change', (e) => patch({ demoSession: e.target.value }));
  $('#demoCar').addEventListener('change', (e) => patch({ demoCar: e.target.value }));
  $('#lockOn').addEventListener('click', () => { if (!S.locked) patch({ locked: true }); });
  $('#lockOff').addEventListener('click', () => {
    if (!S.locked) return;
    patch({ locked: false });
    if (lastStatus === 'waiting' && !S.editLayout) toast('Ohne Session sind die Overlays ausgeblendet. Zum Verschieben «Positionieren» nutzen.');
  });
  $('#layoutSel').addEventListener('change', (e) => {
    selectLayout(e.target.value);
    if (S.editLayout) patch({ editLayout: e.target.value });
  });
  $('#posBtn').addEventListener('click', () => {
    if (S.editLayout) { patch({ editLayout: null, locked: true }); toast('Positionen gespeichert'); }
    else { patch({ editLayout: ui.layout, locked: false }); toast('Overlays erscheinen jetzt auf dem Bildschirm'); }
  });
  $('#posDone').addEventListener('click', () => patch({ editLayout: null, locked: true }));

  // ================= Start =================
  function renderHome() {
    const active = layoutInfo && S.layouts[layoutInfo.active];
    const cat = layoutInfo && D.SESSIONS[layoutInfo.category];
    $('#heroNum').textContent = S.carNumber || '13';
    $('#heroDriver').textContent = S.driverName || 'Overlays';
    $('#heroBig').textContent = lastStatus === 'live' ? 'In der Session' : lastStatus === 'demo' ? 'Demo läuft' : 'Bereit';
    $('#heroSmall').textContent = !active ? '' : S.editLayout ? `Wird positioniert: ${S.layouts[S.editLayout] ? S.layouts[S.editLayout].name : ''}`
      : lastStatus === 'waiting' ? 'Overlays erscheinen, sobald du in einer iRacing-Session bist.'
      : `Aktives Layout: ${active.name}${cat ? ` (${cat})` : ''}${lastCar === true ? ' · im Auto' : lastCar === false ? ' · in der Box' : ''}`;
    const L = active || S.layouts[ui.layout];
    $('#tileOverlays').textContent = Object.values(L.overlays).filter((o) => o.enabled).length;
    $('#tileOverlaysK').textContent = `Overlays aktiv in «${L.name}»`;
    $('#tileStreams').textContent = Object.keys(S.streams).length;
    const pre = D.PRESETS.find((p) => themeEq({ ...D.THEME, ...p }, S.theme));
    $('#tileTheme').textContent = pre ? pre.name : 'Eigene Farben';
    $('#tileSource').textContent = S.source === 'demo' ? 'Demo' : 'iRacing';
    renderAssign();
  }
  function renderAssign() {
    const box = $('#assign');
    if (box.contains(document.activeElement)) return;
    const opts = (sel) => layoutIds().map((id) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${esc(S.layouts[id].name)}</option>`).join('');
    box.innerHTML = Object.entries(D.SESSIONS).map(([k, label]) =>
      `<label class="field">${label}<select data-assign="${k}">${opts(S.gameAssign[k])}</select></label>`).join('');
  }
  $('#assign').addEventListener('change', (e) => {
    const k = e.target.dataset.assign;
    if (k) patch({ gameAssign: { [k]: e.target.value } });
  });

  // ================= Overlays (Spiel) =================
  function selectLayout(id) {
    ui.layout = id;
    refresh();
  }
  function newLayout() {
    const id = D.newId('l');
    ui.layout = id;
    patch({ layouts: { [id]: D.gameLayout(`Layout ${layoutIds().length + 1}`) } });
    toast('Neues Layout angelegt');
  }
  function renderLayoutTool() {
    const l = S.layouts[ui.layout];
    const name = $('#layoutName');
    if (document.activeElement !== name) name.value = l.name;
    const tags = sessionsOf(ui.layout);
    $('#layoutTag').innerHTML = tags.length ? `Für <b>${tags.join(', ')}</b>` : 'Keiner Session zugeordnet (Start → Zuordnung)';
    $('#layoutDel').disabled = layoutIds().length < 2;
  }
  $('#layoutName').addEventListener('input', (e) => {
    const v = e.target.value.trim() || 'Layout';
    patchSoon('lname', { layouts: { [ui.layout]: { name: v } } }, 400);
  });
  $('#layoutNew').addEventListener('click', newLayout);
  $('#layoutDup').addEventListener('click', () => {
    const src = S.layouts[ui.layout];
    const id = D.newId('l');
    ui.layout = id;
    patch({ layouts: { [id]: { ...JSON.parse(JSON.stringify(src)), name: `${src.name} (Kopie)`.slice(0, 40) } } });
    toast('Layout dupliziert');
  });
  $('#layoutDel').addEventListener('click', () => {
    const l = S.layouts[ui.layout];
    if (layoutIds().length < 2) return;
    if (!confirm(`Layout «${l.name}» löschen?`)) return;
    const id = ui.layout;
    ui.layout = layoutIds().find((x) => x !== id);
    patch({ layouts: { [id]: null } });
  });
  $('#resetPos').addEventListener('click', () => { command({ cmd: 'resetPositions', layout: ui.layout }); toast('Positionen zurückgesetzt'); });
  $('#filter').addEventListener('input', (e) => {
    ui.filter = e.target.value.trim().toLowerCase();
    renderGrid();
    renderSide();
  });

  const previewSrc = (type) => `/overlays/${type}.html?mode=preview&layout=${encodeURIComponent(ui.layout)}`;
  function renderGrid() {
    const grid = $('#grid');
    renderedLayout = ui.layout;
    const L = S.layouts[ui.layout];
    const list = gameOrder().filter(matches);
    grid.classList.toggle('flat', !!ui.filter);
    grid.innerHTML = list.length ? list.map((type) => {
      const t = D.TYPES[type], o = L.overlays[type];
      return `<article class="ocard ${WIDE.has(type) ? 'wide' : ''} ${o.enabled ? 'on' : ''}" data-type="${type}" tabindex="0" role="button" aria-label="${esc(t.title)} öffnen">
        <div class="scene s-${SCENE[type] || 'steel'}"></div>
        <div class="pv"><iframe src="${previewSrc(type)}" width="${t.w}" height="${t.h}" title="Vorschau ${esc(t.title)}" tabindex="-1" loading="lazy"></iframe></div>
        ${NEW.has(type) ? '<span class="badge">NEU</span>' : ''}
        <label class="switch" title="Im Layout anzeigen"><input type="checkbox" data-toggle="${type}" ${o.enabled ? 'checked' : ''}><span>${o.enabled ? 'An' : 'Aus'}</span></label>
        <div class="cap"><h3>${icon(type)}${esc(t.title)}</h3><p>${esc(INFO[type])}</p></div>
      </article>`;
    }).join('') : '<p class="empty">Kein Overlay passt zum Filter.</p>';
    fitPreviews();
  }
  // Vorschau mittig in die Karte einpassen
  function fitFrame(box, fr, t, pad = 18) {
    const bw = box.clientWidth, bh = box.clientHeight;
    if (!bw) return;
    const s = Math.min(1.25, (bw - pad * 2) / t.w, (bh - pad * 2) / t.h);
    fr.style.transform = `scale(${s})`;
    fr.style.left = Math.round((bw - t.w * s) / 2) + 'px';
    fr.style.top = Math.round((bh - t.h * s) / 2) + 'px';
  }
  function fitPreviews() {
    $$('#grid .ocard').forEach((card) => fitFrame($('.pv', card), $('iframe', card), D.TYPES[card.dataset.type]));
  }
  function updateGridState() {
    const L = S.layouts[ui.layout];
    $$('#grid .ocard').forEach((card) => {
      const o = L.overlays[card.dataset.type];
      if (!o) return;
      card.classList.toggle('on', !!o.enabled);
      const inp = $('input[data-toggle]', card);
      if (inp && document.activeElement !== inp) inp.checked = !!o.enabled;
      $('.switch span', card).textContent = o.enabled ? 'An' : 'Aus';
    });
  }
  function setEnabled(type, v) {
    S.layouts[ui.layout].overlays[type].enabled = v; // sofort sichtbar, gespeichert wird direkt danach
    updateGridState(); renderSide(); renderBottom();
    patch({ layouts: { [ui.layout]: { overlays: { [type]: { enabled: v } } } } });
  }
  $('#grid').addEventListener('change', (e) => {
    const t = e.target.dataset.toggle;
    if (t) setEnabled(t, e.target.checked);
  });
  $('#grid').addEventListener('click', (e) => {
    if (e.target.closest('.switch')) return;
    const card = e.target.closest('.ocard');
    if (card) openDetail(card.dataset.type);
  });
  $('#grid').addEventListener('keydown', (e) => {
    const card = e.target.closest('.ocard');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(card.dataset.type); }
  });

  // Detailseite
  function openDetail(type) {
    ui.detail = type;
    if (ui.view !== 'overlays') showView('overlays');
    renderedDetail = '';
    renderOverlays();
    renderSide();
    $('#main').scrollTop = 0;
  }
  function renderOverlays() {
    $('#ovList').hidden = !!ui.detail;
    $('#ovDetail').hidden = !ui.detail;
    renderLayoutTool();
    if (!ui.detail) {
      if (renderedLayout !== ui.layout || !$('#grid').children.length) renderGrid(); else updateGridState();
      return;
    }
    const type = ui.detail, t = D.TYPES[type], o = S.layouts[ui.layout].overlays[type];
    const key = `${ui.layout}/${type}`;
    const box = $('#ovDetail');
    const [bw, bh] = D.baseSize(type, o);
    if (renderedDetail === key) {
      $$('[data-set="enabled"]', box).forEach((x) => x.setAttribute('aria-pressed', String((x.dataset.v === '1') === !!o.enabled)));
      const inp = $('input[data-k="enabled"]', box);
      if (inp) inp.checked = !!o.enabled;
      // neue Grösse: nur die Vorschau anpassen, das Menü bleibt (Fokus beim Tippen)
      const fr = $('.dprev iframe', box);
      if (fr && (Number(fr.width) !== bw || Number(fr.height) !== bh)) { fr.width = bw; fr.height = bh; fitDetail(); }
      return;
    }
    renderedDetail = key;
    box.innerHTML = `
      <div class="dhead">
        <button class="back" data-act="back">${icon('back')}Alle Overlays</button>
        <h1>${icon(type)}${esc(t.title)}</h1>
      </div>
      <div class="dgrid">
        <div class="dprev"><div class="scene s-${SCENE[type] || 'steel'}"></div><div class="pvbox"><iframe src="${previewSrc(type)}" width="${bw}" height="${bh}" title="Vorschau ${esc(t.title)}" tabindex="-1"></iframe></div>
          <p class="dprev-note">${esc(INFO[type])}</p></div>
        <aside class="ctl">
          <div class="ctl-h">Overlay-Steuerung</div>
          <div class="ctl-card">
            <div class="ctl-ic">${icon(type)}</div>
            <div class="ctl-t"><small>${esc(t.title)}</small><b>${esc(S.layouts[ui.layout].name)}</b></div>
          </div>
          <div class="f row ctl-on" data-label="anzeigen layout">
            <span class="fl1">Im Layout anzeigen</span>
            <div class="onoff" role="group" aria-label="Im Layout anzeigen"><button data-set="enabled" data-v="1" aria-pressed="${!!o.enabled}">ON</button><button data-set="enabled" data-v="0" aria-pressed="${!o.enabled}">OFF</button></div>
            <input type="checkbox" data-k="enabled" ${o.enabled ? 'checked' : ''} hidden>
          </div>
          ${accHtml(type, o, 'game')}
        </aside>
      </div>`;
    requestAnimationFrame(fitDetail);
  }
  function fitDetail() {
    const fr = $('#ovDetail .dprev iframe');
    if (!fr || !ui.detail) return;
    const o = S.layouts[ui.layout].overlays[ui.detail];
    const [w, h] = D.baseSize(ui.detail, o);
    fitFrame($('#ovDetail .pvbox'), fr, { w, h }, 30);
  }
  $('#ovDetail').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="back"]')) { openDetail(null); return; }
    const b = e.target.closest('[data-copy]'); if (b) copy(b.dataset.copy);
  });
  $('#ovDetail').addEventListener('input', (e) => {
    const el = e.target, k = el.dataset.k;
    if (!k || !ui.detail) return;
    const v = inputValue(el);
    if (k === 'enabled') { setEnabled(ui.detail, v); return; }
    if (el.type === 'number' && (!Number.isFinite(v) || v < Number(el.min) || v > Number(el.max))) return;
    showOutput(el, v);
    patchSoon(`det-${ui.detail}-${k}`, { layouts: { [ui.layout]: { overlays: { [ui.detail]: { [k]: v } } } } },
      el.type === 'range' ? 120 : el.type === 'number' || el.type === 'text' ? 400 : 0);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.view === 'overlays' && ui.detail && !e.target.closest('input,select')) openDetail(null);
  });

  // ================= Stream =================
  const streamIds = () => Object.keys(S.streams);
  let stageScale = 1;

  function newStream() {
    const id = D.newId('s');
    const base = S.streams[ui.stream];
    const s = D.streamLayout(`Stream ${streamIds().length + 1}`);
    if (base) { s.width = base.width; s.height = base.height; }
    ui.stream = id; ui.widget = null;
    if (ui.view !== 'stream') showView('stream');
    patch({ streams: { [id]: s } });
    toast('Stream-Overlay angelegt. Füge jetzt Elemente hinzu.');
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="newStream"]');
    if (b) newStream();
  });
  function renderStream() {
    const has = !!S.streams[ui.stream];
    $('#streamEmpty').hidden = has;
    $('#streamEdit').hidden = !has;
    if (!has) return;
    const s = S.streams[ui.stream];
    const name = $('#streamName');
    if (document.activeElement !== name) name.value = s.name;
    const sizeSel = $('#streamSize');
    const sv = `${s.width}x${s.height}`;
    if (![...sizeSel.options].some((o) => o.value === sv)) sizeSel.insertAdjacentHTML('beforeend', `<option value="${sv}">${s.width} × ${s.height}</option>`);
    sizeSel.value = sv;
    $('#streamSessions').innerHTML = '<span class="hint">Im Stream zeigen bei:</span>' + Object.entries(D.SESSIONS).map(([k, label]) =>
      `<label><input type="checkbox" data-session="${k}" ${s.sessions[k] !== false ? 'checked' : ''}> ${label}</label>`).join('');
    const url = `${origin}/stream/?id=${encodeURIComponent(ui.stream)}`;
    $('#streamUrl').textContent = url;
    $('#streamHow').innerHTML = `In OBS: Quellen → <b>+</b> → <b>Browser</b>, diese Adresse einfügen, Breite <b>${s.width}</b> und Höhe <b>${s.height}</b> eintragen. Der Hintergrund ist durchsichtig. OM Overlays muss dafür laufen; Änderungen hier erscheinen sofort in OBS.`;
    $('#stageSize').textContent = `${s.width} × ${s.height}`;
    if (ui.widget && !s.widgets[ui.widget]) ui.widget = null;
    OMStream.render($('#canvas'), S, ui.stream, { preview: true, decorate });
    const ids = Object.keys(s.widgets);
    $('#widgetList').innerHTML = ids.length ? '<span>Auf der Leinwand:</span>' + ids.map((id) =>
      `<button class="chip" data-pick="${id}" aria-pressed="${id === ui.widget}">${esc(D.TYPES[s.widgets[id].type].title)}</button>`).join('') : '';
    $$('#canvas .om-widget').forEach((el) => el.classList.toggle('sel', el.dataset.widget === ui.widget));
    fitStage();
    renderInspector();
  }

  function fitStage() {
    const s = S && S.streams[ui.stream];
    const stage = $('#stage');
    if (!s || !stage.parentElement.clientWidth) return;
    stageScale = stage.parentElement.clientWidth / s.width;
    stage.style.height = Math.round(s.height * stageScale) + 'px';
    $('#canvas').style.transform = `scale(${stageScale})`;
    $('#canvas').style.setProperty('--inv', String(1 / stageScale));
  }
  window.addEventListener('resize', () => { fitStage(); fitPreviews(); fitDetail(); });

  $('#streamName').addEventListener('input', (e) => patchSoon('sname', { streams: { [ui.stream]: { name: e.target.value.trim() || 'Stream' } } }, 400));
  $('#streamSize').addEventListener('change', (e) => {
    const [w, h] = e.target.value.split('x').map(Number);
    const s = S.streams[ui.stream];
    // Elemente proportional mitnehmen, damit das Bild gleich aussieht
    const f = w / s.width;
    const widgets = {};
    for (const [id, x] of Object.entries(s.widgets)) widgets[id] = { x: Math.round(x.x * f), y: Math.round(x.y * f), scale: Math.round(x.scale * f * 100) / 100 };
    patch({ streams: { [ui.stream]: { width: w, height: h, widgets } } });
  });
  $('#streamSessions').addEventListener('change', (e) => {
    const k = e.target.dataset.session;
    if (k) patch({ streams: { [ui.stream]: { sessions: { [k]: e.target.checked } } } });
  });
  $('#streamDup').addEventListener('click', () => {
    const src = S.streams[ui.stream];
    const id = D.newId('s');
    ui.stream = id; ui.widget = null;
    patch({ streams: { [id]: { ...JSON.parse(JSON.stringify(src)), name: `${src.name} (Kopie)`.slice(0, 40) } } });
    toast('Stream-Overlay dupliziert. Es hat eine eigene OBS-Adresse.');
  });
  $('#streamDel').addEventListener('click', () => {
    const s = S.streams[ui.stream];
    if (!confirm(`Stream-Overlay «${s.name}» löschen? Die OBS-Quelle mit dieser Adresse bleibt danach leer.`)) return;
    const id = ui.stream;
    ui.stream = streamIds().find((x) => x !== id) || null; ui.widget = null;
    patch({ streams: { [id]: null } });
  });
  $('#streamCopy').addEventListener('click', () => copy($('#streamUrl').textContent));

  // Elemente hinzufügen
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b || !S.streams[ui.stream]) return;
    const s = S.streams[ui.stream];
    const t = D.TYPES[b.dataset.add];
    if (t.streamOnly) {
      const existing = Object.keys(s.widgets).find((k) => s.widgets[k].type === b.dataset.add);
      if (existing) { select(existing); toast('Dieses Stream-Overlay hat schon ein Garagen-Cover.'); return; }
    }
    const n = Object.keys(s.widgets).length % 8;
    const id = D.newId('w');
    const w = t.streamOnly ? D.widget(b.dataset.add, 0, 0)
      : D.widget(b.dataset.add, Math.round((s.width - t.w) / 2) + n * 30, Math.round((s.height - t.h) / 2) + n * 30);
    ui.widget = id;
    patch({ streams: { [ui.stream]: { widgets: { [id]: w } } } });
  });

  // Ziehen, Auswählen, Tastatur
  function select(wid) {
    ui.widget = wid;
    $$('#widgetList [data-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pick === wid)));
    $$('#canvas .om-widget').forEach((el) => el.classList.toggle('sel', el.dataset.widget === wid));
    renderInspector();
  }
  function moveWidget(el, wid, x, y) {
    const s = S.streams[ui.stream];
    const w = s.widgets[wid];
    const t = wsize(w);
    x = Math.round(Math.min(Math.max(x, 0), s.width - t.w * w.scale));
    y = Math.round(Math.min(Math.max(y, 0), s.height - t.h * w.scale));
    el.style.left = x + 'px'; el.style.top = y + 'px';
    w.x = x; w.y = y; // lokal sofort, gespeichert wird gebündelt
    const px = $('#insX'), py = $('#insY');
    if (px && ui.widget === wid) { px.value = x; py.value = y; }
    return { x, y };
  }
  function decorate(el, wid) {
    // Griff rechts unten: ziehen ändert die Grösse (Seitenverhältnis bleibt)
    const h = document.createElement('div');
    h.className = 'resize-h';
    h.title = 'Ziehen: Grösse ändern';
    el.appendChild(h);
    let rs = null;
    h.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const w = S.streams[ui.stream].widgets[wid];
      rs = { sx: e.clientX, sy: e.clientY, scale: w.scale, t: wsize(w) };
      h.setPointerCapture(e.pointerId);
    });
    h.addEventListener('pointermove', (e) => {
      if (!rs) return;
      const s = S.streams[ui.stream], w = s.widgets[wid];
      const bw = rs.t.w * rs.scale, bh = rs.t.h * rs.scale;
      const rx = (bw + (e.clientX - rs.sx) / stageScale) / bw, ry = (bh + (e.clientY - rs.sy) / stageScale) / bh;
      let sc = rs.scale * (Math.abs(rx - 1) > Math.abs(ry - 1) ? rx : ry);
      // nicht über den Rand der Leinwand hinaus
      sc = Math.min(sc, (s.width - w.x) / rs.t.w, (s.height - w.y) / rs.t.h, 3);
      sc = Math.round(Math.max(0.3, sc) * 100) / 100;
      w.scale = sc;
      el.style.width = Math.round(rs.t.w * sc) + 'px';
      el.style.height = Math.round(rs.t.h * sc) + 'px';
      el.firstChild.style.transform = `scale(${sc})`;
      const r = $('#inspector input[data-k="scale"]');
      if (r) { r.value = sc; showOutput(r, sc); }
    });
    const rsEnd = () => {
      if (!rs) return;
      rs = null;
      patch({ streams: { [ui.stream]: { widgets: { [wid]: { scale: S.streams[ui.stream].widgets[wid].scale } } } } });
    };
    h.addEventListener('pointerup', rsEnd);
    h.addEventListener('pointercancel', rsEnd);

    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${D.TYPES[el.dataset.type].title} – ziehen zum Verschieben`);
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      select(wid);
      const w = S.streams[ui.stream].widgets[wid];
      drag = { sx: e.clientX, sy: e.clientY, ox: w.x, oy: w.y, moved: false };
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.sx) / stageScale, dy = (e.clientY - drag.sy) / stageScale;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      drag.moved = true;
      // Shift: in 10er-Schritten einrasten
      const snap = (v) => (e.shiftKey ? Math.round(v / 10) * 10 : v);
      moveWidget(el, wid, snap(drag.ox + dx), snap(drag.oy + dy));
    });
    const end = () => {
      if (!drag) return;
      el.classList.remove('dragging');
      if (drag.moved) {
        const w = S.streams[ui.stream].widgets[wid];
        patch({ streams: { [ui.stream]: { widgets: { [wid]: { x: w.x, y: w.y } } } } });
      }
      drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      const w = S.streams[ui.stream].widgets[wid];
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) {
        e.preventDefault();
        select(wid);
        const p = moveWidget(el, wid, w.x + d[0], w.y + d[1]);
        patchSoon('nudge', { streams: { [ui.stream]: { widgets: { [wid]: p } } } }, 300);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeWidget(wid);
      }
    });
  }
  function removeWidget(wid) {
    if (ui.widget === wid) ui.widget = null;
    patch({ streams: { [ui.stream]: { widgets: { [wid]: null } } } });
  }

  function renderInspector() {
    const box = $('#inspector');
    const s = S.streams[ui.stream];
    const w = s && ui.widget && s.widgets[ui.widget];
    const key = w ? `${ui.stream}/${ui.widget}` : `none/${ui.stream}/${Object.keys(s ? s.widgets : {}).length}`;
    if (key === renderedInspector && box.innerHTML) {
      if (w && $('#insX') && !box.contains(document.activeElement)) { $('#insX').value = w.x; $('#insY').value = w.y; }
      return;
    }
    renderedInspector = key;
    if (!w) {
      const n = Object.keys(s.widgets).length;
      box.innerHTML = `<h3>Element bearbeiten</h3><p class="hint">${n
        ? 'Klicke ein Element auf der Leinwand an, um Grösse und Optionen zu ändern. Ziehen verschiebt es, mit gedrückter Umschalttaste in 10er-Schritten. Pfeiltasten verschieben pixelgenau.'
        : 'Noch leer. Füge unter der Leinwand Elemente hinzu, zum Beispiel Standings und Relative.'}</p>`;
      return;
    }
    const t = D.TYPES[w.type];
    if (t.streamOnly) {
      box.innerHTML = `
        <h3>${t.title}</h3>
        <p class="hint" style="margin-bottom:10px">Füllt die ganze Leinwand und liegt in OBS über allen anderen Elementen. Im Editor ist es blass im Hintergrund.</p>
        <div class="opts">
          <div class="opt full"><span>Deckkraft <output>${Math.round(w.opacity * 100)}</output> %</span><input type="range" min="0.1" max="1" step="0.02" value="${w.opacity}" data-k="opacity"></div>
          ${optsHtml(w.type, w.options)}
        </div>
        <div class="row-acts"><button class="btn" data-act="removeWidget">Entfernen</button></div>`;
      return;
    }
    box.innerHTML = `
      <h3>${icon(w.type)} ${t.title}</h3>
      <div class="pos">
        <label class="field">X (px)<input type="number" id="insX" data-k="x" value="${w.x}" step="1"></label>
        <label class="field">Y (px)<input type="number" id="insY" data-k="y" value="${w.y}" step="1"></label>
      </div>
      ${accHtml(w.type, { ...w.options, scale: w.scale, opacity: w.opacity }, 'stream')}
      <div class="row-acts"><button class="btn" data-act="removeWidget">Entfernen</button></div>`;
  }
  $('#inspector').addEventListener('input', (e) => {
    const el = e.target;
    const k = el.dataset.k;
    if (!k || !ui.widget) return;
    const v = inputValue(el);
    if (el.type === 'number' && !Number.isFinite(v)) return;
    showOutput(el, v);
    const top = ['x', 'y', 'scale', 'opacity'].includes(k);
    let p = top ? { [k]: v } : { options: { [k]: v } };
    if (k === 'x' || k === 'y' || k === 'scale') {
      // Element bleibt ganz auf der Leinwand: Position nach Bedarf nachziehen
      const s = S.streams[ui.stream], w = { ...s.widgets[ui.widget], ...p }, t = wsize(w);
      const x = Math.round(Math.min(Math.max(w.x, 0), Math.max(0, s.width - t.w * w.scale)));
      const y = Math.round(Math.min(Math.max(w.y, 0), Math.max(0, s.height - t.h * w.scale)));
      p = { ...p, x, y };
      if (k !== 'x') $('#insX').value = x;
      if (k !== 'y') $('#insY').value = y;
    }
    patchSoon(`ins-${k}`, { streams: { [ui.stream]: { widgets: { [ui.widget]: p } } } }, el.type === 'range' ? 120 : 250);
  });
  // Beim Verlassen eines Positionsfelds den tatsächlich gespeicherten (begrenzten) Wert zeigen
  $('#inspector').addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if ((k !== 'x' && k !== 'y') || !ui.widget) return;
    const s = S.streams[ui.stream], w = s.widgets[ui.widget], t = wsize(w);
    const max = k === 'x' ? s.width - t.w * w.scale : s.height - t.h * w.scale;
    e.target.value = Math.round(Math.min(Math.max(Number(e.target.value) || 0, 0), Math.max(0, max)));
  });
  // Eigenes Cover-Bild hochladen
  const coverFile = document.createElement('input');
  coverFile.type = 'file';
  coverFile.accept = 'image/png,image/jpeg,image/webp,image/gif';
  coverFile.addEventListener('change', async () => {
    const f = coverFile.files[0];
    coverFile.value = '';
    if (!f || !ui.widget) return;
    try {
      const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      renderedInspector = '';
      patch({ streams: { [ui.stream]: { widgets: { [ui.widget]: { options: { image: j.url } } } } } });
      toast('Bild übernommen');
    } catch (e) { toast('Bild konnte nicht geladen werden: ' + e.message); }
  });
  $('#inspector').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="coverUpload"]')) { coverFile.click(); return; }
    if (e.target.closest('[data-act="coverReset"]') && ui.widget) {
      renderedInspector = '';
      patch({ streams: { [ui.stream]: { widgets: { [ui.widget]: { options: { image: '' } } } } } });
      return;
    }
    if (e.target.closest('[data-act="removeWidget"]') && ui.widget) removeWidget(ui.widget);
  });
  $('#widgetList').addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) select(b.dataset.pick); });
  // Klick ins Leere hebt die Auswahl auf
  $('#stage').addEventListener('pointerdown', (e) => { if (!e.target.closest('.om-widget')) select(null); });

  // ================= Farben =================
  const COLOR_FIELDS = [
    ['accent', 'Akzentfarbe', 'Tabs, eigene Zeile, Markierungen'],
    ['panel', 'Hintergrund', 'Fläche der Overlays'],
    ['text', 'Text', 'Namen und Zahlen'],
    ['gain', 'Schneller', 'Zeitgewinn, Gas'],
    ['loss', 'Langsamer', 'Zeitverlust, Bremse'],
  ];
  // Hauptfenster: nur die Akzentfarbe übernehmen (das Fenster bleibt dunkel)
  function applyAccent() {
    const v = D.themeVars(S.theme);
    const root = document.documentElement.style;
    root.setProperty('--gold', v['--gold']);
    root.setProperty('--accent-rgb', v['--accent-rgb']);
    root.setProperty('--on-accent', v['--on-accent']);
    root.setProperty('--gold-pale', D.themeVars({ ...S.theme, panel: '#16171A' })['--gold-pale']);
  }
  const themeEq = (a, b) => Object.keys(D.THEME).every((k) => (a[k] || '').toUpperCase() === (b[k] || '').toUpperCase());
  function renderColors() {
    if (!S) return;
    const t = S.theme;
    $('#presets').innerHTML = D.PRESETS.map((p, i) => {
      const full = { ...D.THEME, ...p };
      return `<button class="preset" data-preset="${i}" aria-pressed="${themeEq(full, t)}"><i style="background:${full.accent}"></i>${esc(p.name)}</button>`;
    }).join('');
    const box = $('#colorFields');
    if (!box.children.length) {
      box.innerHTML = COLOR_FIELDS.map(([k, label, hint]) =>
        `<label class="color-field"><input type="color" data-color="${k}"><span>${label}<small>${hint}</small></span></label>`).join('');
    }
    for (const [k] of COLOR_FIELDS) {
      const inp = $(`input[data-color="${k}"]`, box);
      if (document.activeElement !== inp) inp.value = t[k].toLowerCase();
    }
    const pv = $('#themePreview');
    if (!$('.fr', pv)) {
      const L = (layoutInfo && layoutInfo.active) || Object.keys(S.layouts)[0];
      pv.insertAdjacentHTML('beforeend', ['relative', 'delta', 'fuel'].map((type) => {
        const tt = D.TYPES[type], sc = 0.8;
        return `<div class="fr" style="width:${Math.round(tt.w * sc)}px;height:${Math.round(tt.h * sc)}px"><iframe src="/overlays/${type}.html?mode=preview&layout=${encodeURIComponent(L)}" width="${tt.w}" height="${tt.h}" style="transform:scale(${sc})" tabindex="-1" title="Vorschau ${tt.title}"></iframe></div>`;
      }).join(''));
    }
  }
  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    const p = D.PRESETS[Number(b.dataset.preset)];
    patch({ theme: { ...D.THEME, ...p, name: undefined } });
  });
  $('#colorFields').addEventListener('input', (e) => {
    const k = e.target.dataset.color;
    if (k) patchSoon('color-' + k, { theme: { [k]: e.target.value.toUpperCase() } }, 80);
  });
  $('#themeReset').addEventListener('click', () => patch({ theme: { ...D.THEME } }));

  // ---------- Gemeinsam ----------
  function ensureSelection() {
    if (!S.layouts[ui.layout]) ui.layout = (layoutInfo && S.layouts[layoutInfo.active]) ? layoutInfo.active : layoutIds()[0];
    if (!S.streams[ui.stream]) { ui.stream = Object.keys(S.streams)[0] || null; ui.widget = null; }
    if (ui.detail && !S.layouts[ui.layout].overlays[ui.detail]) ui.detail = null;
  }
  function refresh() {
    if (!S) return;
    ensureSelection();
    applyAccent();
    renderBottom();
    renderSide();
    renderHome();
    renderOverlays();
    if (ui.view === 'colors') renderColors();
    renderStream();
    $('#demoHint').hidden = lastStatus !== 'waiting';
  }

  // Einstellungen
  $('#clearTrack').addEventListener('click', async () => {
    try {
      const r = await (await command({ cmd: 'clearTrack' })).json();
      toast(r.cleared === false ? 'Für diese Strecke ist eine Karte hinterlegt, nichts aufzuzeichnen' : 'Karte wird neu aufgezeichnet');
    } catch { toast('Karte wird neu aufgezeichnet'); }
  });
  $('#autostart').addEventListener('change', (e) => {
    patch({ autostart: e.target.checked });
    toast(e.target.checked ? 'Startet ab jetzt mit Windows im Hintergrund' : 'Autostart aus');
  });
  $('#quitBtn').addEventListener('click', () => command({ cmd: 'quit' }));
  $('#autoUpdate').addEventListener('change', (e) => patch({ autoUpdate: e.target.checked }));
  $('#checkBtn').addEventListener('click', () => command({ cmd: 'updateCheck' }));

  // ---------- Updates ----------
  function notesHtml(text) {
    const items = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^#/.test(l)).map((l) => l.replace(/^[-*]\s+/, ''));
    return items.length ? '<ul>' + items.map((l) => `<li>${esc(l)}</li>`).join('') + '</ul>' : '';
  }
  function renderUpdate(u) {
    $('#ver').textContent = u.current || '–';
    $('#verTop').textContent = u.current || '–';
    const box = $('#update');
    $('#updMsg').textContent = u.phase === 'checking' ? 'Suche …' : u.phase === 'uptodate' ? 'Du hast die neueste Version.' : '';
    $('#checkBtn').disabled = ['checking', 'downloading', 'installing'].includes(u.phase);
    const notes = notesHtml(u.notes);
    let html = '';
    box.className = 'update';
    if (u.phase === 'available') {
      html = `<div><h2>Version ${esc(u.latest)} ist verfügbar</h2><p>Installiert sich in wenigen Sekunden, danach startet OM Overlays neu. Deine Einstellungen bleiben erhalten.</p></div>
        <div class="acts"><button class="btn primary" data-act="install">Jetzt installieren</button></div>
        ${notes ? `<details><summary>Was ist neu</summary>${notes}</details>` : ''}`;
    } else if (u.phase === 'downloading') {
      const p = Math.round((u.progress || 0) * 100);
      html = `<div><h2>Version ${esc(u.latest)} wird geladen</h2><p>${p} %</p></div><div class="bar"><i style="width:${p}%"></i></div>`;
    } else if (u.phase === 'ready') {
      html = `<div><h2>Update ${esc(u.latest)} ist bereit</h2><p>Du bist gerade in einer iRacing-Session. Das Update wird automatisch installiert, sobald du sie verlässt.</p></div>`;
    } else if (u.phase === 'installing') {
      html = `<div><h2>Update wird installiert</h2><p>OM Overlays beendet sich jetzt und startet mit Version ${esc(u.latest)} neu.</p></div>`;
    } else if (u.phase === 'error') {
      box.className = 'update err';
      html = `<div><h2>Update nicht möglich</h2><p>${esc(u.error || 'Unbekannter Fehler.')}</p></div>
        <div class="acts">${u.latest ? '<button class="btn" data-act="install">Erneut versuchen</button>' : '<button class="btn" data-act="check">Erneut suchen</button>'}</div>`;
    }
    box.innerHTML = html;
    box.hidden = !html;
  }
  $('#update').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'install') { b.disabled = true; command({ cmd: 'updateInstall' }); }
    if (b.dataset.act === 'check') command({ cmd: 'updateCheck' });
  });

  // ---------- Verbindung ----------
  showView(ui.view);
  OMLink.connect({
    update: renderUpdate,
    settings(data) {
      const first = !S;
      S = data;
      if (first && layoutInfo && S.layouts[layoutInfo.active]) ui.layout = layoutInfo.active;
      refresh();
      if (first) showView(ui.view);
    },
    layout(info) {
      const first = !layoutInfo;
      layoutInfo = info;
      if (first && S && S.layouts[info.active] && !ui.detail) { ui.layout = info.active; refresh(); }
      else if (S) renderHome();
    },
    frame(f) {
      if (f.status === lastStatus && f.inCar === lastCar) return;
      lastStatus = f.status;
      lastCar = f.inCar;
      const el = $('#status');
      el.className = 'status ' + f.status;
      const where = f.status === 'waiting' || f.inCar === null || f.inCar === undefined ? '' : f.inCar ? ' · im Auto' : ' · in der Box';
      $('span', el).textContent = (STATUS[f.status] || f.status) + where;
      if (S) { renderHome(); $('#demoHint').hidden = lastStatus !== 'waiting'; }
    },
    close() { const el = $('#status'); el.className = 'status'; $('span', el).textContent = 'Keine Verbindung zum Core'; lastStatus = ''; },
  });
})();
