'use strict';
// Fest hinterlegte Streckenkarten (web/tracks/<TrackID>.json), erzeugt mit tools/tracks/build_library.py.
// Punkt i liegt bei LapDistPct = i / n, beginnend bei Start/Ziel in Fahrtrichtung.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'web', 'tracks');
const cache = new Map();

function load(id) {
  const key = String(Number(id) || 0);
  if (cache.has(key)) return cache.get(key);
  let data = null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, key + '.json'), 'utf8'));
    if (Array.isArray(j.pts) && j.pts.length >= 200) {
      const pts = [];
      for (let i = 0; i + 1 < j.pts.length; i += 2) pts.push([j.pts[i], j.pts[i + 1]]);
      data = { id: j.id, pts, turns: j.turns || [] };
    }
  } catch { /* keine Karte für diese Strecke */ }
  cache.set(key, data);
  return data;
}

module.exports = { load, DIR };
