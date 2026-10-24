#!/usr/bin/env python3
"""Baut die fest hinterlegten Streckenkarten (web/tracks/<TrackID>.json).

Quelle: tracks.json aus dem MIT-lizenzierten Projekt irdashies (github.com/tariknz/irdashies),
das die offiziellen iRacing-Streckengrafiken in Pfade umrechnet. Wir tasten jeden Pfad in
gleichen Abständen der Rundendistanz ab, beginnend bei Start/Ziel in Fahrtrichtung. Punkt i liegt
damit genau bei LapDistPct = i / N – die Anzeige muss nichts mehr rechnen.

Aufruf: python3 tools/tracks/build_library.py <pfad/zu/tracks.json> [ausgabe-ordner]
"""
import json, math, os, re, sys

N = 720  # Punkte pro Runde

def resample(t):
    pts = t['active']['trackPathPoints']
    total = t['active']['totalLength']
    sf = t['startFinish']['point']['length']
    anti = t['startFinish'].get('direction') == 'anticlockwise'
    out = []
    n = len(pts)
    for i in range(N):
        adj = total * i / N
        length = (sf + adj) % total if anti else (sf - adj + total) % total
        f = length / total * (n - 1)
        a = int(math.floor(f)); b = min(a + 1, n - 1); u = f - a
        out.append((pts[a]['x'] + (pts[b]['x'] - pts[a]['x']) * u, pts[a]['y'] + (pts[b]['y'] - pts[a]['y']) * u))
    # leichtes Glätten gegen die Pixel-Treppen der Vorlage (Kreis-Mittelwert über 5 Punkte)
    sm = []
    for i in range(N):
        xs = [out[(i + k) % N][0] for k in range(-2, 3)]
        ys = [out[(i + k) % N][1] for k in range(-2, 3)]
        sm.append((sum(xs) / 5, sum(ys) / 5))
    return sm

def merge_turns(raw):
    """Kurvennummern zusammensetzen: In den Vorlagen ist «11» oft als zwei einzelne «1» gespeichert
    (gleiche Grundlinie, dicht nebeneinander). Namen ohne Nummer lassen wir weg."""
    items = []
    for tr in raw:
        c = str(tr.get('content', '')).strip()
        if c and 'x' in tr and 'y' in tr: items.append([c, float(tr['x']), float(tr['y'])])
    items.sort(key=lambda i: (round(i[2]), i[1]))
    used, out = set(), []
    for i, (c, x, y) in enumerate(items):
        if i in used: continue
        text, lastx, n = c, x, 1
        while True:
            nxt = next((j for j, (c2, x2, y2) in enumerate(items) if j not in used and j != i and abs(y2 - y) < 2.5
                        and 0 < x2 - lastx < 30 and re.fullmatch(r'[0-9A-Za-z]{1,2}', c2)), None)
            if nxt is None: break
            used.add(nxt); text += items[nxt][0]; lastx = items[nxt][1]; n += 1
        used.add(i)
        m = re.fullmatch(r'(?:T|Turn\s*)?(\d{1,2}[a-zA-Z]?)', text)
        if not m: continue
        # Mittelpunkt der Beschriftung (Vorlage gibt den Anfang der Grundlinie an)
        out.append({'t': m.group(1), 'x': (x + lastx) / 2 + 9, 'y': y - 11})
    return out

def order_score(pts, turns):
    nums = []
    for tr in turns:
        m = re.match(r'\d+', tr['t'])
        d = [math.hypot(p[0] - tr['x'], p[1] - tr['y']) for p in pts]
        nums.append((int(m.group()), d.index(min(d)) / N))
    nums.sort()
    if len(nums) < 4: return None, None
    sc = lambda q: sum(((y - x) % 1) < 0.5 for (_, x), (_, y) in zip(q, q[1:])) / (len(q) - 1)
    return sc(nums), sc([(a, (1 - x) % 1) for a, x in nums])

def build(src, dst):
    data = json.load(open(src))
    os.makedirs(dst, exist_ok=True)
    index, warn = {}, []
    for tid, t in data.items():
        try:
            if not t.get('active') or not t.get('startFinish') or not t['startFinish'].get('point'):
                warn.append((tid, 'unvollständig')); continue
            pts = resample(t)
        except Exception as e:
            warn.append((tid, str(e))); continue
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        turns = merge_turns(t.get('turns') or [])
        for tr in turns: xs.append(tr['x']); ys.append(tr['y'])
        # auf 0..1000 normieren, y nach oben (wie die aufgezeichneten Karten)
        minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
        s = 1000 / max(maxx - minx, maxy - miny, 1)
        X = lambda x: round((x - minx) * s, 1)
        Y = lambda y: round((maxy - y) * s, 1)
        flat = []
        for x, y in pts: flat += [X(x), Y(y)]
        # Fahrtrichtung prüfen: Die Kurvennummern müssen in Fahrtrichtung aufsteigen. Laufen sie
        # (fast) alle rückwärts, ist die Richtung in der Vorlage falsch → umdrehen.
        fw, bw = order_score(pts, turns)
        if fw is not None and fw <= 0.2 and bw >= 0.8:
            pts = [pts[0]] + pts[:0:-1]
            warn.append((tid, f'Richtung korrigiert ({fw:.2f} → {bw:.2f})'))
        # Prüfung: Kurve «1» sollte im ersten Teil der Runde liegen
        t1 = next((tr for tr in turns if tr['t'] == '1'), None)
        if t1:
            d = [math.hypot(p[0] - t1['x'], p[1] - t1['y']) for p in pts]
            k = d.index(min(d)) / N
            if 0.5 < k < 0.97: warn.append((tid, f'Kurve 1 erst bei {k:.2f}'))
        out = {'id': int(tid), 'n': N, 'pts': flat, 'turns': [{'t': tr['t'], 'x': X(tr['x']), 'y': Y(tr['y'])} for tr in turns]}
        with open(os.path.join(dst, f'{tid}.json'), 'w') as fh:
            json.dump(out, fh, separators=(',', ':'))
        index[tid] = len(turns)
    with open(os.path.join(dst, 'index.json'), 'w') as fh:
        json.dump(sorted(int(k) for k in index), fh, separators=(',', ':'))
    return index, warn

if __name__ == '__main__':
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', '..', 'web', 'tracks')
    index, warn = build(src, dst)
    print(f'{len(index)} Strecken geschrieben, {len(warn)} Hinweise')
    for w in warn: print('  ', *w)
