/**
 * Minimal PDF writer — pack multiple page canvases into one printable PDF.
 *
 * WHY THIS EXISTS: the obvious choice is jsPDF, but pulling a CDN script into a
 * page that promises "your photo never leaves your device" is a contradiction.
 * This writes PDF 1.4 by hand: catalog -> pages -> page -> content -> image
 * XObject x N -> xref -> trailer. Images are DeviceGray 8bpc, optionally
 * Flate-compressed with the browser's native CompressionStream.
 *
 * BROWSER ONLY: buildPdf takes HTMLCanvasElement pages and uses Blob /
 * CompressionStream / Response. Node has CompressionStream (v18+) but no canvas.
 *
 * No third-party code. Extracted from https://coloringzap.com
 * (multi-photo -> printable coloring book PDF).
 */

export const PAGE_W = 612;   // US Letter, points
export const PAGE_H = 792;
export const MARGIN = 40;

/** Latin-1 encode a string to bytes. */
export function strBytes(s) {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
  return a;
}

/**
 * Deflate bytes with the platform CompressionStream.
 * @returns {Promise<Uint8Array|null>} null if CompressionStream is unavailable
 */
export function deflateBytes(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
}

/** Pull grayscale samples straight out of a canvas (line art: r=g=b). */
export function graySamples(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = d[i * 4];
  return g;
}

/** Scale-to-fit a w x h box inside boxW x boxH, centred. */
export function fitRect(w, h, boxW, boxH) {
  const s = Math.min(boxW / w, boxH / h);
  const dw = w * s, dh = h * s;
  return { dw, dh, x: (boxW - dw) / 2, y: (boxH - dh) / 2 };
}

/**
 * Build a PDF from page canvases.
 * @param {Array<{canvas:HTMLCanvasElement,label?:string}>} pages
 * @returns {Promise<Uint8Array>} the PDF bytes
 */
export function buildPdf(pages) {
  const chunks = [];
  let pos = 0;
  const offsets = [];
  function push(b) { chunks.push(b); pos += b.length; }
  function pushStr(s) { push(strBytes(s)); }

  pushStr('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker

  const total = pages.length;
  const objCount = 2 + total * 3;
  const objNum = (i) => 3 + i * 3;   // page object
  const contNum = (i) => 4 + i * 3;  // content stream
  const imgNum = (i) => 5 + i * 3;   // image XObject

  function writeObj(num, body, streamBytes) {
    offsets[num] = pos;
    pushStr(num + ' 0 obj\n' + body + '\n');
    if (streamBytes) { pushStr('stream\n'); push(streamBytes); pushStr('\nendstream\n'); }
    pushStr('endobj\n');
  }

  offsets[1] = pos;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids = [];
  for (let i = 0; i < total; i++) kids.push(objNum(i) + ' 0 R');
  offsets[2] = pos;
  pushStr('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + total + ' >>\nendobj\n');

  return (function next(i) {
    if (i >= total) return Promise.resolve();
    const pg = pages[i];
    const w = pg.canvas.width, h = pg.canvas.height;
    const f = fitRect(w, h, PAGE_W - MARGIN * 2, PAGE_H - MARGIN * 2);
    const samples = graySamples(pg.canvas);

    return Promise.resolve(deflateBytes(samples)).then(function (def) {
      const useFlate = !!def && def.length < samples.length;
      const data = useFlate ? def : samples;

      const imgBody = '<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h +
        ' /ColorSpace /DeviceGray /BitsPerComponent 8' +
        (useFlate ? ' /Filter /FlateDecode' : '') +
        ' /Length ' + data.length + ' >>';

      const content = 'q\n' +
        f.dw.toFixed(2) + ' 0 0 ' + f.dh.toFixed(2) + ' ' +
        (MARGIN + f.x).toFixed(2) + ' ' + (MARGIN + f.y).toFixed(2) + ' cm\n' +
        '/Im0 Do\nQ\n';

      offsets[objNum(i)] = pos;
      pushStr(objNum(i) + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] ' +
        '/Resources << /XObject << /Im0 ' + imgNum(i) + ' 0 R >> >> /Contents ' + contNum(i) + ' 0 R >>\nendobj\n');

      writeObj(contNum(i), '<< /Length ' + content.length + ' >>', strBytes(content));
      writeObj(imgNum(i), imgBody, data);

      return next(i + 1);
    });
  })(0).then(function () {
    const xrefPos = pos;
    const n = objCount + 1;
    let xref = 'xref\n0 ' + n + '\n0000000000 65535 f \n';
    for (let k = 1; k < n; k++) {
      const off = offsets[k] || 0;
      xref += ('0000000000' + off).slice(-10) + ' 00000 n \n';
    }
    pushStr(xref);
    pushStr('trailer\n<< /Size ' + n + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

    const out = new Uint8Array(pos);
    let o = 0;
    for (let c = 0; c < chunks.length; c++) { out.set(chunks[c], o); o += chunks[c].length; }
    return out;
  });
}
