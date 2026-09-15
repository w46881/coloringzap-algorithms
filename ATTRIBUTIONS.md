# Third-party attributions

Short version: **this repository contains no third-party code.**

Every algorithm here (`src/*.js`) was written from scratch for the tool at
<https://coloringzap.com>. There are no vendored libraries, no copied
snippets, and no runtime dependencies — `package.json` has no dependencies
because there are none.

## Platform APIs used (not third-party, but worth naming)

| API | Where | Notes |
|---|---|---|
| `CompressionStream('deflate')` | `src/pdf-writer.js` | W3C Streams API, built into modern browsers and Node 18+. Used instead of a JS zip library so nothing has to be loaded from a CDN. |
| `Blob` / `Response` | `src/pdf-writer.js` | Standard web platform APIs. |
| Typed arrays (`Uint8Array`, `Float32Array`, …) | all modules | ECMAScript standard. |

## Why no libraries

The tool this came from promises that a visitor's photo never leaves their
device. Pulling an image-processing or PDF library from a CDN would break that
promise (the browser would have to fetch code from someone else's server), so
the edge detection, colour quantisation, and PDF writer are all hand-written.

## If you reuse this

MIT applies (see `LICENSE`). You do not need to attribute us beyond keeping the
copyright notice, but a link back is always appreciated:
<https://coloringzap.com>
