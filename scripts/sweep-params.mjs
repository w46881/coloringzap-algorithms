/**
 * Parameter sweep + sample generator.
 *
 * Run:  node scripts/sweep-params.mjs
 *
 * Produces docs/PARAMETERS.md numbers and the sample PNGs in samples/.
 * Everything printed here is measured, not estimated.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { photoToLineArt, toGrayscale, gaussianBlur, sobelEdge, dilate } from '../src/edge-detection.js';

const OUT = path.join(process.cwd(), 'samples');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- minimal 8-bit grayscale PNG encoder (no deps) ---------- */
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodeGrayPNG(w, h, gray) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = gray[y * w + x]; }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- synthetic test images (RGBA, stand in for photo classes) ---------- */
const W = 400, H = 300;
function rgba(fn) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = fn(x, y); const i = (y * W + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return d;
}
const rnd = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();

const IMAGES = {
  'flat-vector (bold shapes, hard edges)': rgba((x, y) => {
    const cx = 200, cy = 150;
    const d = Math.hypot(x - cx, y - cy);
    if (d < 70) return 40;                       // dark disc
    if (x > 300 && y < 100) return 220;          // light square
    return 180;                                  // mid background
  }),
  'smooth-portrait (soft gradients)': rgba((x, y) => {
    const u = x / W, v = y / H;
    return 90 + 120 * Math.exp(-(((u - 0.5) ** 2 + (v - 0.45) ** 2) / 0.06)) - 30 * v;
  }),
  'detailed-texture (fine repeat)': rgba((x, y) => {
    return 128 + 60 * Math.sin(x * 0.35) * Math.cos(y * 0.31) + 30 * Math.sin((x + y) * 0.7);
  }),
  'noisy-lowlight (grainy)': rgba((x, y) => {
    return 60 + 40 * Math.sin(x * 0.02) * Math.sin(y * 0.025) + (rnd() - 0.5) * 90;
  }),
};

/* ---------- metrics ---------- */
// "clean" for a colouring page = enough line to colour, but not a muddy blob,
// and as few isolated specks as possible.
function metrics(edges, w, h) {
  let edge = 0, isolated = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (edges[y * w + x] !== 255) continue;
    edge++;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && edges[ny * w + nx] === 255) n++;
    }
    if (n === 0) isolated++;
  }
  const total = w * h;
  return {
    coverage: (100 * edge) / total,          // % of page that is line
    speck: edge ? (100 * isolated) / edge : 0 // % of line pixels that are lone specks
  };
}

// Score: penalise too-sparse (<1.5%) and too-dense (>12%) coverage, and specks.
function score(m) {
  let pen = 0;
  if (m.coverage < 1.5) pen += (1.5 - m.coverage) * 12;
  if (m.coverage > 12) pen += (m.coverage - 12) * 6;
  return m.speck * 2 + pen;   // lower = better
}

const GRID = [];
for (const blurRadius of [0, 1, 2, 3]) for (const threshold of [20, 40, 60, 90]) for (const dilateIterations of [0, 1]) GRID.push({ blurRadius, threshold, dilateIterations });

const rows = [];
let sampleIdx = 0;
for (const [label, data] of Object.entries(IMAGES)) {
  let best = null;
  for (const p of GRID) {
    const edges = photoToLineArt(data, W, H, { ...p, denoise: true });
    const m = metrics(edges, W, H);
    const s = score(m);
    if (!best || s < best.s) best = { ...p, ...m, s };
  }
  rows.push({ label, ...best });

  // emit one sample pair per image class (input + best output)
  const tag = String(++sampleIdx).padStart(2, '0');
  const grayIn = toGrayscale(data, W, H);
  const inBytes = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inBytes[i] = Math.max(0, Math.min(255, grayIn[i]));
  fs.writeFileSync(path.join(OUT, `sample-${tag}-input.png`), encodeGrayPNG(W, H, inBytes));
  const out = photoToLineArt(data, W, H, { ...best, denoise: true });
  fs.writeFileSync(path.join(OUT, `sample-${tag}-lineart.png`), encodeGrayPNG(W, H, out));
}

/* ---------- report ---------- */
const DATE = new Date().toISOString().slice(0, 10);
console.log('| image class | blur radius | sobel threshold | dilate | line coverage % | lone-speck % |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.label} | ${r.blurRadius} | ${r.threshold} | ${r.dilateIterations} | ${r.coverage.toFixed(2)} | ${r.speck.toFixed(2)} |`);
}
console.log(`\nreview date: ${DATE}`);
console.log(`grid searched: ${GRID.length} combos x ${Object.keys(IMAGES).length} image classes`);
fs.writeFileSync(path.join(OUT, 'REVIEW-DATE.txt'), DATE + '\n');
