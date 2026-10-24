// Setzt die Elemente eines Stream-Overlays auf eine Leinwand (für OBS und den Editor).
// Elemente bleiben beim Aktualisieren bestehen (kein Neuladen, kein Flackern) – nur Position,
// Grösse und Deckkraft werden angepasst; neue kommen dazu, entfernte verschwinden.
window.OMStream = {
  render(canvas, settings, streamId, opts) {
    const o = opts || {};
    const s = settings && settings.streams && settings.streams[streamId];
    canvas.style.width = (s ? s.width : 1920) + 'px';
    canvas.style.height = (s ? s.height : 1080) + 'px';
    const widgets = s ? s.widgets : {};
    const seen = new Set();
    for (const [wid, w] of Object.entries(widgets)) {
      const type = OMDefaults.TYPES[w.type];
      if (!type) continue;
      seen.add(wid);
      let el = canvas.querySelector(`[data-widget="${wid}"]`);
      if (!el || el.dataset.type !== w.type) {
        if (el) el.remove();
        el = document.createElement('div');
        el.className = 'om-widget';
        el.dataset.widget = wid;
        el.dataset.type = w.type;
        const fr = document.createElement('iframe');
        fr.src = `/overlays/${w.type}.html?stream=${encodeURIComponent(streamId)}&widget=${encodeURIComponent(wid)}${o.preview ? '&mode=preview' : ''}`;
        fr.width = type.w;
        fr.height = type.h;
        fr.setAttribute('tabindex', '-1');
        fr.setAttribute('title', type.title);
        fr.style.cssText = 'border:0;display:block;background:transparent;pointer-events:none;transform-origin:0 0;';
        el.appendChild(fr);
        if (o.decorate) o.decorate(el, wid);
        canvas.appendChild(el);
      }
      if (type.streamOnly) {
        // Garagen-Cover: immer ganze Leinwand; in OBS zuoberst, im Editor zuunterst
        const W = s.width, H = s.height;
        el.classList.add('is-cover');
        el.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:${o.preview ? 0 : 1000};`;
        el.firstChild.width = W; el.firstChild.height = H;
        el.firstChild.style.transform = 'none';
        continue;
      }
      el.style.cssText = `position:absolute;left:${w.x}px;top:${w.y}px;width:${Math.round(type.w * w.scale)}px;height:${Math.round(type.h * w.scale)}px;z-index:1;`;
      el.firstChild.style.transform = `scale(${w.scale})`;
    }
    for (const el of [...canvas.querySelectorAll('[data-widget]')]) {
      if (!seen.has(el.dataset.widget)) el.remove();
    }
  },
};
