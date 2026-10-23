'use strict';
// Toleranter Parser für den Session-String von iRacing (vereinfachtes YAML).
// iRacing schreibt Fahrernamen u. ä. ungequotet – echte YAML-Parser stolpern teils darüber.
// Hier gilt: alles nach "Schlüssel: " ist ein Wert. Zahlen werden umgewandelt,
// ausser sie haben führende Nullen (Startnummern wie "007" bleiben Text).

const NUM = /^-?(0|[1-9]\d*)(\.\d+)?$/;

function scalar(v) {
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    return v.slice(1, -1);
  }
  if (NUM.test(v)) return Number(v);
  return v;
}

function parse(text) {
  const root = {};
  const stack = [{ ind: 0, node: root }];
  let pending = null; // Schlüssel ohne Wert: Map oder Liste folgt (oder leer)
  const top = () => stack[stack.length - 1];

  const putKey = (ind, text) => {
    const i = text.indexOf(':');
    if (i < 0) return;
    const key = text.slice(0, i).trim();
    const val = text.slice(i + 1).trim();
    const node = top().node;
    if (Array.isArray(node)) return;
    if (val === '') { node[key] = null; pending = { obj: node, key, ind }; }
    else node[key] = scalar(val);
  };

  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.startsWith('---') || line.startsWith('...')) continue;
    const ind = line.length - line.trimStart().length;
    const text = line.trim();
    const isItem = text === '-' || text.startsWith('- ');

    if (pending) {
      const p = pending;
      pending = null;
      if (isItem && ind >= p.ind) {
        const arr = []; p.obj[p.key] = arr; stack.push({ ind, node: arr });
      } else if (!isItem && ind > p.ind) {
        const m = {}; p.obj[p.key] = m; stack.push({ ind, node: m });
      }
    }

    if (isItem) {
      while (stack.length > 1 && (top().ind > ind || (top().ind === ind && !Array.isArray(top().node)))) stack.pop();
      if (!Array.isArray(top().node)) continue; // unerwartet – ignorieren
      const rest = text === '-' ? '' : text.slice(2).trim();
      if (rest && rest.indexOf(':') < 0) { top().node.push(scalar(rest)); continue; }
      const item = {};
      top().node.push(item);
      stack.push({ ind: ind + 2, node: item });
      if (rest) putKey(ind + 2, rest);
    } else {
      while (stack.length > 1 && (top().ind > ind || Array.isArray(top().node))) stack.pop();
      putKey(ind, text);
    }
  }
  return root;
}

module.exports = { parse };
