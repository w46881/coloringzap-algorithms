/**
 * Color quantization — reduce a photo to a small palette so each region can
 * carry a number (color-by-number sheets).
 *
 * Pipeline:  boxBlur -> kmeans -> mapToPalette -> cleanIndex
 *
 * Pure functions, no DOM, no dependencies. Runs in browsers and Node.js.
 * Extracted from the production tool at https://coloringzap.com
 * (photo -> color-by-number / "picture to color by number").
 */

/**
 * Separable box blur (in-place on RGBA).
 * @param {{data:Uint8ClampedArray,width:number,height:number}} imgd
 * @param {number} radius 0 disables
 */
export function boxBlur(imgd, radius) {
  if (radius <= 0) return;
  const w = imgd.width, h = imgd.height, d = imgd.data;
  const tmp = new Float32Array(w * h * 3);
  let i, x, y;
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k; if (xx < 0 || xx >= w) continue;
        const p = (y * w + xx) * 4; r += d[p]; g += d[p + 1]; b += d[p + 2]; n++;
      }
      i = (y * w + x) * 3; tmp[i] = r / n; tmp[i + 1] = g / n; tmp[i + 2] = b / n;
    }
  }
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      let r2 = 0, g2 = 0, b2 = 0, n2 = 0;
      for (let k2 = -radius; k2 <= radius; k2++) {
        const yy = y + k2; if (yy < 0 || yy >= h) continue;
        const q = (yy * w + x) * 3; r2 += tmp[q]; g2 += tmp[q + 1]; b2 += tmp[q + 2]; n2++;
      }
      const o = (y * w + x) * 4;
      d[o] = r2 / n2; d[o + 1] = g2 / n2; d[o + 2] = b2 / n2;
    }
  }
}

/**
 * k-means over a deterministic subsample of the pixels.
 *
 * Note: the seed is deterministic (evenly spread across the sample list), so the
 * same input always yields the same palette. The only non-deterministic branch is
 * the empty-cluster fallback (Math.random), which is rare in practice.
 *
 * @param {Uint8ClampedArray} d RGBA bytes
 * @param {number} k number of colours
 * @returns {number[][]} palette as [[r,g,b], ...]
 */
export function kmeans(d, w, h, k) {
  const total = w * h;
  const step = Math.max(1, Math.floor(total / 24000));
  const samples = [];
  for (let i = 0; i < total; i += step) {
    const p = i * 4;
    samples.push([d[p], d[p + 1], d[p + 2]]);
  }
  const cent = [];
  for (let c = 0; c < k; c++) {
    const si = Math.floor((c * samples.length) / k);
    cent.push([samples[si][0], samples[si][1], samples[si][2]]);
  }
  const assign = new Uint8Array(samples.length);
  for (let it = 0; it < 12; it++) {
    const sums = [], counts = [];
    for (let a = 0; a < k; a++) { sums.push([0, 0, 0]); counts.push(0); }
    for (let s = 0; s < samples.length; s++) {
      let best = 0, bd = Infinity;
      const px = samples[s];
      for (let cc = 0; cc < k; cc++) {
        const dr = px[0] - cent[cc][0], dg = px[1] - cent[cc][1], db = px[2] - cent[cc][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bd) { bd = dist; best = cc; }
      }
      assign[s] = best;
      sums[best][0] += px[0]; sums[best][1] += px[1]; sums[best][2] += px[2];
      counts[best]++;
    }
    for (let m = 0; m < k; m++) {
      if (counts[m] > 0) {
        cent[m] = [sums[m][0] / counts[m], sums[m][1] / counts[m], sums[m][2] / counts[m]];
      } else {
        const rs = Math.floor(Math.random() * samples.length);
        cent[m] = [samples[rs][0], samples[rs][1], samples[rs][2]];
      }
    }
  }
  return cent.map((v) => [Math.round(v[0]), Math.round(v[1]), Math.round(v[2])]);
}

/**
 * Map every pixel to the nearest palette entry.
 * @returns {Uint16Array} palette index per pixel
 */
export function mapToPalette(d, w, h, palette) {
  const total = w * h, idx = new Uint16Array(total), k = palette.length;
  for (let i = 0; i < total; i++) {
    const p = i * 4, r = d[p], g = d[p + 1], b = d[p + 2];
    let best = 0, bd = Infinity;
    for (let c = 0; c < k; c++) {
      const dr = r - palette[c][0], dg = g - palette[c][1], db = b - palette[c][2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bd) { bd = dist; best = c; }
    }
    idx[i] = best;
  }
  return idx;
}

/**
 * Majority filter: a pixel whose colour index is rare among its 8 neighbours is
 * switched to the most common neighbour index. Removes specks.
 */
export function cleanIndex(idx, w, h, passes) {
  let cur = idx;
  for (let pass = 0; pass < passes; pass++) {
    const out = new Uint16Array(cur.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const counts = {};
        let bestV = cur[i], bestC = -1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const v = cur[ny * w + nx];
            counts[v] = (counts[v] || 0) + 1;
            if (counts[v] > bestC) { bestC = counts[v]; bestV = v; }
          }
        }
        out[i] = bestC >= 5 ? bestV : cur[i];
      }
    }
    cur = out;
  }
  return cur;
}
