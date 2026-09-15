# Tested parameters — which settings give the cleanest line art

> **Review date: 2026-09-15**
> Reproduce with: `node scripts/sweep-params.mjs`
> Every number below is measured by that script, not estimated.

## How "clean" was measured

Two numbers per run:

- **line coverage %** — share of pixels that become black line. Below ~1.5% the
  page is nearly blank; above ~12% it turns into a muddy grey blob.
- **lone-speck %** — share of line pixels that have *no* neighbouring line pixel
  (isolated dots). These are what make a page look dirty. Lower is better.

The winning combination is the one that minimises
`2 × lone-speck% + penalty(coverage outside 1.5–12%)`.

## Results

| image class | blur radius | sobel threshold | dilate | line coverage % | lone-speck % |
|---|---|---|---|---|---|
| flat-vector (bold shapes, hard edges) | 0 | 20 | 1 | 2.52 | 0.00 |
| smooth-portrait (soft gradients) | 0 | 20 | 0 | **0.00** | 0.00 |
| detailed-texture (fine repeat) | 3 | 90 | 0 | 23.55 | 0.00 |
| noisy-lowlight (grainy) | 1 | 90 | 0 | 4.02 | 0.00 |

Grid searched: **32 combinations × 4 image classes** (blur radius 0–3, threshold
20/40/60/90, dilate 0–1).

## What the numbers actually say

1. **`lone-speck %` is 0.00 everywhere** — good news. The `removeNoise`
   (drop isolated pixels) step does its job; speckle is not the failure mode here.
2. **Smooth gradients are the hard case.** The `smooth-portrait` class produced
   **0.00% coverage at every one of the 32 settings** — the gradient has no
   local step for Sobel to catch, so nothing crosses the threshold. If your
   photo is mostly soft shading (a plain sky, a smooth cheek, an out-of-focus
   background), **expect an empty page**. This is a real limit, not a bug —
   see *Known limits* in the README.
3. **Fine detail needs blur + a high threshold.** `detailed-texture` only became
   printable at blur radius 3 / threshold 90, and even then coverage is 23.55% —
   above the "clean" ceiling, because the source itself is edge-dense. Busy
   photos need aggressive smoothing or they stay muddy.
4. **Bold shapes are easy.** `flat-vector` is clean at threshold 20 / dilate 1
   with 2.52% coverage — right in the printable band.

## Starting points

| your photo looks like | try |
|---|---|
| bold shapes, cartoon, logo, high contrast | `blurRadius: 0–1, threshold: 20–40, dilate: 1` |
| noisy / low light | `blurRadius: 1, threshold: 90, dilate: 0` |
| busy / very detailed | `blurRadius: 3, threshold: 90, dilate: 0` (expect heavy coverage) |
| mostly smooth gradients | **this method will not produce a usable page** |

These are starting points on synthetic test images, not gospel for real photos.
Re-run `scripts/sweep-params.mjs` against your own images before shipping.
