// Hauptfenster von OM Overlays: Spiel-Layouts, Zuordnung je Session-Art, Stream-Editor, Updates.
(function () {
  const D = OMDefaults;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const origin = location.origin;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const INFO = {
    relative:  'Fahrer direkt vor und hinter dir auf der Strecke, mit Abstand in Sekunden.',
    standings: 'Rangliste mit Abstand, letzter und bester Runde.',
    fuel:      'Verbrauch pro Runde, Reichweite und wie viel du beim Stopp nachtanken musst.',
    inputs:    'Gas, Bremse, Kupplung und Lenkung als Verlauf, dazu Gang und Tempo.',
    delta:     'Delta zur Bestzeit mit Rundenprognose.',
    trackmap:  'Alle Autos live auf der Strecke. Die Karte wird beim ersten Mal aus deiner Fahrt aufgezeichnet.',
    flags:     'Aktuelle Flagge mit Meldung, zum Beispiel Gelb, Blau, Safety Car oder letzte Runde.',
    digiflag:  'Grosse LED-Flaggentafel wie an der Strecke. Erscheint nur, wenn eine Flagge aktiv ist.',
    timer:     'Verbleibende Zeit oder Runden der Session mit Fortschrittsbalken.',
    datablock: 'Ein einzelner Wert deiner Wahl, zum Beispiel Rundenzeit, Tempo oder Streckentemperatur.',
    pithelper: 'Boxengasse: Begrenzer, Tempo zum Limit, Distanz zum Boxenplatz und Reifenwerte.',
    gmeter:    'Längs- und Querkräfte mit Traktionskreis deiner Session.',
    cover:     'Standbild über dem ganzen Stream, solange du in der Garage bist.',
  };
  const STATUS = {
    live: 'iRacing verbunden, Overlays aktiv',
    demo: 'Demo läuft, Overlays aktiv',
    waiting: 'Wartet auf iRacing. Overlays erscheinen, sobald du in einer Session bist.',
  };

  let S = null;              // Einstellungen
  let layoutInfo = null;     // { active, category, editing } vom Core
  let lastStatus = '';
  let lastCar = undefined;
  const ui = { tab: 'game', layout: null, stream: null, widget: null };
  let renderedLayout = null; // für welches Layout die Karten gerade gebaut sind
  let renderedInspector = '';
  try { ui.tab = localStorage.getItem('om.tab') || 'game'; } catch { /* egal */ }

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

  // ---------- Optionen je Overlay-Typ (für Karten und Stream-Inspektor) ----------
  function showHtml(o, type) {
    if (type === 'cover') return '';
    return `<div class="opt full"><span>Sichtbar</span><select data-k="show">${Object.entries(D.SHOW).map(([k, l]) =>
      `<option value="${k}" ${(o.show || 'both') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  }
  function optsHtml(type, o) {
    return showHtml(o, type) + typeOptsHtml(type, o);
  }
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
      case 'trackmap': return `
        <div class="opt"><span>Drehen <output>${o.rotate}</output>°</span><input type="range" min="0" max="345" step="15" value="${o.rotate}" data-k="rotate"></div>
        <div class="opt"><label class="chk"><input type="checkbox" data-k="mirror" ${o.mirror ? 'checked' : ''}> Spiegeln</label><label class="chk"><input type="checkbox" data-k="showNumbers" ${o.showNumbers !== false ? 'checked' : ''}> Startnummern</label></div>`;
    }
    return '';
  }
  const inputValue = (el) => (el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value);
  function showOutput(el, v) {
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = (el.dataset.k === 'scale' || el.dataset.k === 'opacity') ? Math.round(v * 100) : v;
  }

  // ---------- Kopf ----------
  function renderHeader() {
    $$('[data-source]').forEach((b) => b.setAttribute('aria-pressed', String(S.source === b.dataset.source)));
    $('#demoSession').hidden = S.source !== 'demo';
    $('#demoSession').value = S.demoSession;
    $('#demoCar').hidden = S.source !== 'demo';
    $('#demoCar').value = S.demoCar;
    const lock = $('#lockBtn');
    lock.textContent = S.locked ? 'Overlays entsperren' : 'Overlays sperren';
    lock.className = 'btn ' + (S.locked ? '' : 'unlocked');
    $('#brandNum').textContent = S.carNumber || '13';
    $('#autostart').checked = !!S.autostart;
    $('#autoUpdate').checked = S.autoUpdate !== false;
  }
  $$('[data-source]').forEach((b) => b.addEventListener('click', () => patch({ source: b.dataset.source })));
  $('#demoSession').addEventListener('change', (e) => patch({ demoSession: e.target.value }));
  $('#demoCar').addEventListener('change', (e) => patch({ demoCar: e.target.value }));
  $('#lockBtn').addEventListener('click', () => {
    patch({ locked: !S.locked });
    if (S.locked && lastStatus === 'waiting' && !S.editLayout) toast('Ohne Session sind die Overlays ausgeblendet. Zum Verschieben «Auf dem Bildschirm positionieren» nutzen.');
  });

  // ---------- Reiter ----------
  function showTab(t) {
    ui.tab = t;
    try { localStorage.setItem('om.tab', t); } catch { /* egal */ }
    $('#tab-game').setAttribute('aria-selected', String(t === 'game'));
    $('#tab-stream').setAttribute('aria-selected', String(t === 'stream'));
    $('#tab-colors').setAttribute('aria-selected', String(t === 'colors'));
    $('#pane-game').hidden = t !== 'game';
    $('#pane-stream').hidden = t !== 'stream';
    $('#pane-colors').hidden = t !== 'colors';
    if (t === 'colors') renderColors();
    if (t === 'stream') requestAnimationFrame(fitStage);
    else requestAnimationFrame(fitPreviews);
  }
  $('#tab-game').addEventListener('click', () => showTab('game'));
  $('#tab-stream').addEventListener('click', () => showTab('stream'));
  $('#tab-colors').addEventListener('click', () => showTab('colors'));

  // ================= Im Spiel =================
  const layoutIds = () => Object.keys(S.layouts);
  const sessionsOf = (id) => Object.keys(D.SESSIONS).filter((k) => S.gameAssign[k] === id).map((k) => D.SESSIONS[k]);

  function renderAssign() {
    const box = $('#assign');
    const opts = (sel) => layoutIds().map((id) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${esc(S.layouts[id].name)}</option>`).join('');
    const active = layoutInfo && S.layouts[layoutInfo.active];
    const cat = layoutInfo && D.SESSIONS[layoutInfo.category];
    const now = !active ? '' : layoutInfo.editing
      ? `Wird positioniert: <b>${esc(active.name)}</b>`
      : lastStatus === 'waiting' ? 'Gerade keine Session'
      : `Jetzt aktiv: <b>${esc(active.name)}</b>${cat ? ` (${cat})` : ''}`;
    if (box.contains(document.activeElement)) { $('.now', box).innerHTML = now; return; }
    box.innerHTML = Object.entries(D.SESSIONS).map(([k, label]) =>
      `<label class="field">${label}<select data-assign="${k}">${opts(S.gameAssign[k])}</select></label>`).join('') +
      `<span class="now">${now}</span>`;
  }
  $('#assign').addEventListener('change', (e) => {
    const k = e.target.dataset.assign;
    if (k) patch({ gameAssign: { [k]: e.target.value } });
  });

  function renderLayoutChips() {
    $('#layoutChips').innerHTML = layoutIds().map((id) => {
      const tags = sessionsOf(id);
      return `<button class="chip" data-layout="${id}" aria-pressed="${id === ui.layout}">${esc(S.layouts[id].name)}${tags.length ? `<small>${tags.join(', ')}</small>` : ''}</button>`;
    }).join('') + '<button class="chip add" data-act="newLayout">+ Neues Layout</button>';
  }
  $('#layoutChips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'newLayout') {
      const id = D.newId('l');
      ui.layout = id;
      patch({ layouts: { [id]: D.gameLayout(`Layout ${layoutIds().length + 1}`) } });
      toast('Neues Layout angelegt');
    } else if (b.dataset.layout) {
      ui.layout = b.dataset.layout;
      refresh();
    }
  });

  function renderLayoutToolbar() {
    const l = S.layouts[ui.layout];
    const name = $('#layoutName');
    if (document.activeElement !== name) name.value = l.name;
    $('#layoutDel').disabled = layoutIds().length < 2;
    const editingThis = S.editLayout === ui.layout;
    $('#posStart').hidden = editingThis;
    const bar = $('#positioning');
    bar.hidden = !S.editLayout;
    if (S.editLayout) {
      const en = S.layouts[S.editLayout];
      $('#positioningText').textContent = `«${en ? en.name : ''}» wird jetzt auf dem Bildschirm angezeigt. Ziehe die Overlays an ihren Platz und klicke danach auf «Fertig positioniert».`;
    }
  }
  $('#layoutName').addEventListener('input', (e) => {
    const v = e.target.value.trim() || 'Layout';
    patchSoon('lname', { layouts: { [ui.layout]: { name: v } } }, 400);
  });
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
  $('#posStart').addEventListener('click', () => {
    patch({ editLayout: ui.layout, locked: false });
    toast('Overlays erscheinen jetzt auf dem Bildschirm');
  });
  $('#posDone').addEventListener('click', () => patch({ editLayout: null, locked: true }));

  function renderCards() {
    const grid = $('#grid');
    const L = ui.layout;
    renderedLayout = L;
    grid.innerHTML = '';
    for (const [type, o] of Object.entries(S.layouts[L].overlays)) {
      const t = D.TYPES[type];
      const url = `${origin}/overlays/${type}.html`;
      const card = document.createElement('section');
      card.className = 'card' + (o.enabled ? ' on' : '');
      card.dataset.type = type;
      card.innerHTML = `
        <div class="preview"><iframe src="/overlays/${type}.html?mode=preview&layout=${encodeURIComponent(L)}" width="${t.w}" height="${t.h}" title="Vorschau ${t.title}" tabindex="-1"></iframe></div>
        <div class="card-head"><h2>${t.title}</h2>
          <label class="switch"><input type="checkbox" data-k="enabled" ${o.enabled ? 'checked' : ''}><span>Anzeigen</span></label></div>
        <div class="opts">
          <div class="opt full" style="color:var(--mist);font-size:13.5px;line-height:1.35">${INFO[type]}</div>
          <div class="opt"><span>Grösse <output>${Math.round(o.scale * 100)}</output> %</span><input type="range" min="0.4" max="3" step="0.05" value="${o.scale}" data-k="scale"></div>
          <div class="opt"><span>Deckkraft <output>${Math.round(o.opacity * 100)}</output> %</span><input type="range" min="0.3" max="1" step="0.02" value="${o.opacity}" data-k="opacity"></div>
          ${optsHtml(type, o)}
        </div>
        <div class="obs"><span class="k">Einzeln in OBS</span><code title="${url}">${url}</code><button class="btn" data-copy="${url}">Kopieren</button></div>`;
      grid.appendChild(card);
    }
    fitPreviews();
  }
  function fitPreviews() {
    $$('#grid .card').forEach((card) => {
      const t = D.TYPES[card.dataset.type];
      const box = $('.preview', card), fr = $('iframe', box);
      const s = Math.min(1, (box.clientWidth - 20) / t.w, (box.clientHeight - 20) / t.h);
      fr.style.transform = `scale(${s})`;
    });
  }
  $('#grid').addEventListener('input', (e) => {
    const el = e.target, card = el.closest('.card');
    if (!card || !el.dataset.k) return;
    const v = inputValue(el);
    showOutput(el, v);
    if (el.dataset.k === 'enabled') card.classList.toggle('on', v);
    patchSoon(`card-${card.dataset.type}-${el.dataset.k}`,
      { layouts: { [renderedLayout]: { overlays: { [card.dataset.type]: { [el.dataset.k]: v } } } } }, el.type === 'range' ? 120 : 0);
  });
  $('#grid').addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) copy(b.dataset.copy); });

  // ================= Stream =================
  const streamIds = () => Object.keys(S.streams);
  let stageScale = 1;

  function renderStreamChips() {
    $('#streamChips').innerHTML = streamIds().map((id) =>
      `<button class="chip" data-stream="${id}" aria-pressed="${id === ui.stream}">${esc(S.streams[id].name)}<small>${S.streams[id].width}×${S.streams[id].height}</small></button>`).join('') +
      '<button class="chip add" data-act="newStream">+ Neues Stream-Overlay</button>';
  }
  function newStream() {
    const id = D.newId('s');
    const base = S.streams[ui.stream];
    const s = D.streamLayout(`Stream ${streamIds().length + 1}`);
    if (base) { s.width = base.width; s.height = base.height; }
    ui.stream = id; ui.widget = null;
    patch({ streams: { [id]: s } });
    toast('Stream-Overlay angelegt. Füge jetzt Elemente hinzu.');
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="newStream"]');
    if (b) newStream();
  });
  $('#streamChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stream]');
    if (!b) return;
    ui.stream = b.dataset.stream; ui.widget = null;
    refresh();
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
    $('#streamSessions').innerHTML = '<span class="hint">Zeigen bei:</span>' + Object.entries(D.SESSIONS).map(([k, label]) =>
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
  window.addEventListener('resize', () => { fitStage(); fitPreviews(); });

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
  $('#adders').insertAdjacentHTML('beforeend', Object.entries(D.TYPES).map(([t, x]) => `<button class="btn" data-add="${t}">${x.title}</button>`).join(''));
  $('#adders').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
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
    const t = D.TYPES[w.type];
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
      rs = { sx: e.clientX, sy: e.clientY, scale: w.scale, t: D.TYPES[w.type] };
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
      <h3>${t.title}</h3>
      <div class="pos">
        <label class="field">X (px)<input type="number" id="insX" data-k="x" value="${w.x}" step="1"></label>
        <label class="field">Y (px)<input type="number" id="insY" data-k="y" value="${w.y}" step="1"></label>
      </div>
      <div class="opts">
        <div class="opt"><span>Grösse <output>${Math.round(w.scale * 100)}</output> %</span><input type="range" min="0.3" max="3" step="0.05" value="${w.scale}" data-k="scale"></div>
        <div class="opt"><span>Deckkraft <output>${Math.round(w.opacity * 100)}</output> %</span><input type="range" min="0.1" max="1" step="0.02" value="${w.opacity}" data-k="opacity"></div>
        ${optsHtml(w.type, w.options)}
      </div>
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
      const s = S.streams[ui.stream], w = { ...s.widgets[ui.widget], ...p }, t = D.TYPES[w.type];
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
    const s = S.streams[ui.stream], w = s.widgets[ui.widget], t = D.TYPES[w.type];
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
    if (!pv.children.length) {
      const L = (layoutInfo && layoutInfo.active) || Object.keys(S.layouts)[0];
      pv.innerHTML = ['relative', 'delta', 'fuel'].map((type) => {
        const tt = D.TYPES[type], sc = 0.85;
        return `<div class="fr" style="width:${Math.round(tt.w * sc)}px;height:${Math.round(tt.h * sc)}px"><iframe src="/overlays/${type}.html?mode=preview&layout=${encodeURIComponent(L)}" width="${tt.w}" height="${tt.h}" style="transform:scale(${sc})" tabindex="-1" title="Vorschau ${tt.title}"></iframe></div>`;
      }).join('');
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
    if (!S.streams[ui.stream]) { ui.stream = streamIds()[0] || null; ui.widget = null; }
  }
  function refresh() {
    if (!S) return;
    ensureSelection();
    applyAccent();
    renderHeader();
    if (ui.tab === 'colors') renderColors();
    renderAssign();
    renderLayoutChips();
    renderLayoutToolbar();
    if (renderedLayout !== ui.layout || !$('#grid').children.length) renderCards();
    renderStreamChips();
    renderStream();
    $('#demoHint').hidden = lastStatus !== 'waiting';
  }

  // Footer
  $('#clearTrack').addEventListener('click', () => { command({ cmd: 'clearTrack' }); toast('Karte wird neu aufgezeichnet'); });
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
  showTab(ui.tab);
  OMLink.connect({
    update: renderUpdate,
    settings(data) { S = data; refresh(); },
    layout(info) {
      const first = !layoutInfo;
      layoutInfo = info;
      if (first && S && !ui.layout) ui.layout = info.active;
      if (S) { renderAssign(); }
    },
    frame(f) {
      if (f.status === lastStatus && f.inCar === lastCar) return;
      lastStatus = f.status;
      lastCar = f.inCar;
      const el = $('#status');
      el.className = 'status ' + f.status;
      const where = f.status === 'waiting' || f.inCar === null || f.inCar === undefined ? '' : f.inCar ? ' – im Auto' : ' – in der Box';
      $('span', el).textContent = (STATUS[f.status] || f.status) + where;
      if (S) { renderAssign(); $('#demoHint').hidden = lastStatus !== 'waiting'; }
    },
    close() { const el = $('#status'); el.className = 'status'; $('span', el).textContent = 'Keine Verbindung zum Core'; lastStatus = ''; },
  });
})();
