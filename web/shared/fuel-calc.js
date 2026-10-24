// Spritrechnung – gemeinsam für Core-Tests (Node) und das Fuel-Overlay (Browser).
// Eingabe: Rohdaten vom Core (Verbrauch pro Runde, Tankinhalt, Restzeit …) und die Optionen
// des jeweiligen Overlays (Reserve, Durchschnitt über N Runden).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OMFuel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function avgOf(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }

  function compute(raw, opts) {
    const o = opts || {};
    const n = Math.max(1, o.avgLaps || 5);
    const recent = (raw.laps || []).slice(-n);
    const avg = avgOf(recent);
    const max = recent.length ? Math.max.apply(null, recent) : null;
    const last = raw.laps && raw.laps.length ? raw.laps[raw.laps.length - 1] : null;
    const times = (raw.lapTimes || []).slice(-n);
    const refLap = times.length ? avgOf(times) : (raw.lapBest > 0 ? raw.lapBest : raw.fallbackLap || null);

    const lapsOfFuel = avg ? raw.fuel / avg : null;
    const lapFrac = raw.lapDistPct >= 0 ? raw.lapDistPct : 0;
    let lapsToGo = null;
    if (raw.lapsRemain !== null && raw.lapsRemain !== undefined && raw.lapsRemain >= 0) {
      lapsToGo = Math.max(0, raw.lapsRemain + 1 - lapFrac);
    } else if (raw.timeRemain > 0 && refLap) {
      // Zeitrennen: Zeit bis Fahnenschwenk + die Runde, in der sie fällt
      lapsToGo = Math.max(0, Math.ceil(raw.timeRemain / refLap + lapFrac) - lapFrac);
    }
    const margin = (o.marginLaps === undefined ? 0.5 : o.marginLaps) * (avg || 0);
    const needTotal = (lapsToGo !== null && avg) ? lapsToGo * avg + margin : null;
    const toAdd = needTotal !== null ? Math.max(0, needTotal - raw.fuel) : null;
    const tank = raw.tank > 0 ? raw.tank : null;
    const stops = (toAdd !== null && tank) ? Math.ceil(toAdd / tank - 1e-9) : null;
    const pitLap = lapsOfFuel !== null ? raw.lapCompleted + Math.max(0, Math.floor(lapsOfFuel + lapFrac) - 1) + 1 : null;
    const min = recent.length ? Math.min.apply(null, recent) : null;
    const marginLaps = o.marginLaps === undefined ? 0.5 : o.marginLaps;

    // Je Verbrauchsannahme (Ø, Max, Min): Reichweite, Nachtankmenge, Rest im Ziel
    const row = (u) => {
      if (!u) return { usage: null, laps: null, refuel: null, finish: null };
      const need = lapsToGo !== null ? lapsToGo * u : null;
      return {
        usage: u,
        laps: raw.fuel / u,
        refuel: need !== null ? Math.max(0, need + marginLaps * u - raw.fuel) : null,
        finish: need !== null && raw.fuel - need >= 0 ? raw.fuel - need : null,
      };
    };

    // Boxenfenster für einen Stopp (mit Ø-Verbrauch): frühestens, wenn ein voller Tank bis ins Ziel
    // reicht; spätestens, bevor der Sprit ausgeht. Rundennummern = Runde, an deren Ende du reinkommst.
    let window = { status: 'unknown', from: null, to: null };
    if (avg && lapsToGo !== null) {
      const cur = raw.lapCompleted + 1;
      if (toAdd === 0) window = { status: 'none', from: null, to: null };
      else if (tank) {
        const latest = pitLap;
        const earliest = Math.max(cur, Math.ceil(raw.lapCompleted + lapFrac + lapsToGo - tank / avg + marginLaps));
        if (earliest > latest) window = { status: 'multi', from: earliest, to: latest };
        else window = { status: cur >= earliest ? 'open' : 'closed', from: earliest, to: latest };
      }
    }

    // Letzte Runden mit Abweichung vom Durchschnitt
    const history = [];
    const L = raw.laps || [], N = raw.lapNos || [];
    for (let i = L.length - 1; i >= 0 && history.length < 5; i--) {
      history.push({ lap: N[i] !== undefined ? N[i] : null, used: L[i], diff: avg ? L[i] - avg : null });
    }

    return {
      fuel: raw.fuel, tank, avg, max, min, last, lapsOfFuel, lapsToGo, toAdd, stops, pitLap,
      samples: L.length, refLap, rows: { avg: row(avg), max: row(max), min: row(min) }, window, history,
    };
  }

  return { compute };
});
