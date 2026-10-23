// Datenverbindung zum Core per WebSocket, mit automatischem Neuverbinden.
// handlers: { settings(data), track(data), frame(data), open(), close() }
window.OMLink = {
  connect(handlers) {
    let ws = null;
    let retry = 500;
    const open = () => {
      ws = new WebSocket(`ws://${location.host}/ws`);
      ws.onopen = () => { retry = 500; handlers.open && handlers.open(); };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        const fn = handlers[m.event];
        if (fn) fn(m.data);
      };
      ws.onclose = () => {
        handlers.close && handlers.close();
        setTimeout(open, retry);
        retry = Math.min(retry * 2, 4000);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* egal */ } };
    };
    open();
  },
};
