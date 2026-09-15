/**
 * Connected-component labelling + region merging for colour-by-number sheets.
 *
 * Without merging, a quantised photo is mostly specks — hundreds of 2-pixel
 * regions that cannot hold a printable number. This merges every region below a
 * size threshold into the neighbour it shares the LONGEST BORDER with, using
 * union-find, 3 passes (merging changes adjacency, so the border map is rebuilt
 * each pass).
 *
 * Pure functions, no DOM, no dependencies. Runs in browsers and Node.js.
 * Extracted from the production tool at https://coloringzap.com
 */

/**
 * Label connected components over a colour-index map (iterative BFS, 8-connectivity).
 * @param {Uint16Array} idx palette index per pixel
 * @returns {{labels:Int32Array, comps:Array}} labels per pixel + component stats
 *          (id, colorIndex, area, centroid cx/cy, bbox minX/maxX/minY/maxY)
 */
export function labelRegions(idx, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const comps = [];
  const queue = new Int32Array(w * h);

  for (let start = 0; start < w * h; start++) {
    if (labels[start] !== -1) continue;
    const colorIndex = idx[start];
    const id = comps.length;
    let head = 0, tail = 0;
    queue[tail++] = start;
    labels[start] = id;

    let area = 0, sx = 0, sy = 0;
    let minX = w, maxX = -1, minY = h, maxY = -1;

    while (head < tail) {
      const cur = queue[head++];
      const cy = (cur / w) | 0, cx = cur - cy * w;
      area++; sx += cx; sy += cy;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (labels[ni] === -1 && idx[ni] === colorIndex) {
            labels[ni] = id;
            queue[tail++] = ni;
          }
        }
      }
    }
    comps.push({ id, colorIndex, area, cx: sx / area, cy: sy / area, minX, maxX, minY, maxY });
  }
  return { labels, comps };
}

/**
 * Merge regions smaller than `threshold` into the neighbour they share the
 * longest border with.
 *
 * @param {number} threshold minimum area (px) for a region to survive on its own
 * @returns {{idx:Uint16Array, labels:Int32Array, comps:Array}} relabelled map,
 *          comps sorted by area descending (ready for number placement)
 */
export function mergeRegions(idx, labels, comps, w, h, threshold) {
  const n = comps.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }

  let rootArea = new Float64Array(n);
  for (let pass = 0; pass < 3; pass++) {
    rootArea = new Float64Array(n);
    for (let i2 = 0; i2 < n; i2++) rootArea[find(i2)] += comps[i2].area;

    // border length between roots
    const adj = new Map();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i0 = y * w + x;
        const a = find(labels[i0]);
        if (x + 1 < w) {
          const b = find(labels[i0 + 1]);
          if (a !== b) { const k1 = a < b ? a * n + b : b * n + a; adj.set(k1, (adj.get(k1) || 0) + 1); }
        }
        if (y + 1 < h) {
          const c = find(labels[i0 + w]);
          if (a !== c) { const k2 = a < c ? a * n + c : c * n + a; adj.set(k2, (adj.get(k2) || 0) + 1); }
        }
      }
    }
    const nbr = new Map();
    adj.forEach(function (v, k) {
      const a = Math.floor(k / n), b = k % n;
      if (!nbr.has(a)) nbr.set(a, new Map());
      if (!nbr.has(b)) nbr.set(b, new Map());
      nbr.get(a).set(b, (nbr.get(a).get(b) || 0) + v);
      nbr.get(b).set(a, (nbr.get(b).get(a) || 0) + v);
    });

    const roots = [];
    for (let r = 0; r < n; r++) if (find(r) === r) roots.push(r);
    roots.sort(function (a, b) { return rootArea[a] - rootArea[b]; });

    let changed = false;
    for (let ri = 0; ri < roots.length; ri++) {
      const r0 = roots[ri];
      if (find(r0) !== r0) continue;
      if (rootArea[r0] >= threshold) break;
      const nb = nbr.get(r0);
      if (!nb) continue;
      let best = -1, bestV = -1;
      nb.forEach(function (v, b) {
        if (find(b) === find(r0)) return;
        if (v > bestV) { bestV = v; best = b; }
      });
      if (best < 0) continue;
      parent[find(r0)] = find(best);
      changed = true;
    }
    if (!changed) break;
  }

  const colorOf = new Int32Array(n);
  for (let ci = 0; ci < n; ci++) colorOf[ci] = comps[ci].colorIndex;

  const newIdx = new Uint16Array(idx.length);
  const newLabels = new Int32Array(labels.length);
  const stats = new Map();
  for (let p = 0; p < labels.length; p++) {
    const root = find(labels[p]);
    newLabels[p] = root;
    newIdx[p] = colorOf[root];
    let s = stats.get(root);
    if (!s) {
      s = { area: 0, sx: 0, sy: 0, minX: w, maxX: -1, minY: h, maxY: -1, colorIndex: colorOf[root], id: root };
      stats.set(root, s);
    }
    s.area++;
    const py = (p / w) | 0, px = p - py * w;
    s.sx += px; s.sy += py;
    if (px < s.minX) s.minX = px;
    if (px > s.maxX) s.maxX = px;
    if (py < s.minY) s.minY = py;
    if (py > s.maxY) s.maxY = py;
  }
  const out = [];
  stats.forEach(function (s) { s.cx = s.sx / s.area; s.cy = s.sy / s.area; out.push(s); });
  out.sort(function (a, b) { return b.area - a.area; });
  return { idx: newIdx, labels: newLabels, comps: out };
}
