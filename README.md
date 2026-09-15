# coloringzap-algorithms

Image-processing routines for turning photos into printable coloring pages —
edge detection, color quantization, region merging, and a dependency-free PDF
writer. Pure ES modules, no build step, no third-party libraries.

**These are the exact routines that run in the browser at https://coloringzap.com, a free photo-to-coloring-page tool where your picture never leaves your device — the same code, extracted so you can read it, test it, and reuse it.**

## Why this exists

The production site runs all four algorithms client-side, because the promise is
that no photo is ever uploaded. That constraint ruled out every convenient
library — no CDN script, no WASM blob, no server call. So the pipelines got
written by hand, and they turned out to be small enough to just give away.

## Install

No dependencies, no build. Copy the file you want, or:

```bash
git clone https://github.com/w46881/coloringzap-algorithms.git
cd coloringzap-algorithms
node --input-type=module -e "
import { photoToLineArt } from './src/edge-detection.js';
"
```

## What's in here

| file | what it does | used for |
|---|---|---|
| `src/edge-detection.js` | grayscale → Gaussian blur → Sobel → dilate → denoise | photo → black-and-white line art |
| `src/color-quantize.js` | box blur → k-means → palette mapping → majority filter | photo → paint-by-number palette |
| `src/region-merge.js` | connected-component labelling + union-find merging by shared border | merging tiny color regions into colorable ones |
| `src/pdf-writer.js` | hand-written PDF 1.4 writer, grayscale image XObjects, `CompressionStream` | assembling pages into a printable PDF |

Every module is a pure function over typed arrays. No DOM, no canvas, no
`fetch`, no globals — you can run them in Node, in a worker, or in a browser.

### Quick start — photo to line art

```js
import { photoToLineArt } from './src/edge-detection.js';

// rgba: Uint8Array of length width*height*4
const { edges } = photoToLineArt(rgba, width, height, {
  blurRadius: 1,
  threshold: 90,
  dilateIterations: 0,
  denoise: true,
});
// edges: Uint8Array of length width*height, 255 = line, 0 = paper
```

Which numbers to use depends on the photo. That is what
[`docs/PARAMETERS.md`](docs/PARAMETERS.md) is for — it is a **measured** table,
not a guess, with a review date and the script that produced it.

### Quick start — build a PDF

```js
import { buildPdf } from './src/pdf-writer.js';

const bytes = await buildPdf([
  { width: 800, height: 1000, gray: graySamples /* Uint8Array, 8bpc */ },
]);
// bytes: Uint8Array — save it, or new Blob([bytes], {type:'application/pdf'})
```

## The tested parameter table

`docs/PARAMETERS.md` answers one question: **which settings give the cleanest
line art on which kind of photo.**

| image class | blur radius | sobel threshold | dilate | line coverage % | lone-speck % |
|---|---|---|---|---|---|
| flat-vector (bold shapes, hard edges) | 0 | 20 | 1 | 2.52 | 0.00 |
| smooth-portrait (soft gradients) | 0 | 20 | 0 | 0.00 | 0.00 |
| detailed-texture (fine repeat) | 3 | 90 | 0 | 23.55 | 0.00 |
| noisy-lowlight (grainy) | 1 | 90 | 0 | 4.02 | 0.00 |

Review date **2026-09-15**. Regenerate at any time with
`node scripts/sweep-params.mjs` (32 combinations × 4 image classes).
Sample inputs and outputs are in `samples/`.

## Known limits

Being blunt about what this does not do:

1. **Smooth gradients produce nothing.** A soft-shaded photo — plain sky, a
   smooth cheek, an out-of-focus background — has no local step for the Sobel
   operator to catch. In the sweep, the `smooth-portrait` class returned
   **0.00% line coverage at all 32 parameter combinations tested**, i.e. a blank
   page. There is no setting that fixes this. It needs a different algorithm
   (e.g. local adaptive thresholding or tone-based segmentation), which is not
   in this repo.
2. **Busy photos stay muddy.** `detailed-texture` only reached a printable state
   at blur 3 / threshold 90, and even then coverage was 23.55% — well above the
   ~12% ceiling where a page stops looking like line art. Heavy smoothing helps;
   it does not fully solve it.
3. **The parameter table is measured on synthetic images.** The four classes in
   `scripts/sweep-params.mjs` are generated shapes, not real photographs. Treat
   the numbers as a starting point and re-run the sweep on your own images
   before you trust them.
4. **`kmeans` is a fixed-iteration approximation.** 12 iterations, deterministic
   seeding, subsampled to ~24,000 input pixels. It is fast and repeatable, but
   it is not an optimal clustering. Very large palettes (k > 16) get noticeably
   worse.
5. **`removeNoise` is a single-pass neighbour test.** It removes isolated
   single pixels. It does not remove short hairline streaks, and it can thin a
   legitimate 1-pixel-wide line.
6. **`buildPdf` only writes grayscale.** DeviceGray, 8 bits per channel. If you
   need color pages you have to change the color space and the image XObject
   filter — not supported here.
7. **No tests, no CI.** The parameter sweep is the only automated check. There is
   no unit test suite, and no guarantee of API stability.

## Samples

`samples/` holds the synthetic test images used by the sweep — 4 inputs and the
4 line-art outputs the winning parameters produced. They are generated
procedurally by the script, **not** real user photos; no visitor image was used
to build this repo.

## License

MIT — see [`LICENSE`](LICENSE). Copyright (c) 2026 coloringzap.com.

No third-party code is included; see [`ATTRIBUTIONS.md`](ATTRIBUTIONS.md) for
the platform APIs these modules rely on.

## Not in this repo

No API keys, no tokens, no site configuration, and no user images. If you find
something that looks like a secret, it is a mistake — please open an issue.
