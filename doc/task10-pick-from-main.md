# Comparing this branch with `main` (27e96cc) and picking what is worth keeping

`main` and this branch are two independent snapshots of the same idea (the
clone is shallow, so they share no common ancestor — `git diff HEAD 27e96cc`
is the only sensible comparison). They solve the reverse direction very
differently.

| | this branch | `main` |
|---|---|---|
| reverse source | 4 colored HSL linearts (spiral, spokes, rings, flower) + any image as heightmap | 1 grayscale spiral example + any image as heightmap |
| diagram in reverse mode | stays a real HSL diagram | replaced by a grayscale heightmap view |
| mode switching | both pipelines always available, two convert buttons | segmented Direct/Reverse toggle that converts on switch |
| generated image | hue-sorted **serpentine mosaic** (smooth, readable) | **shuffled** mosaic (deliberately unreadable) |
| post-processing | Monte-Carlo / Lloyd spatial relaxation | none |
| roundtrip metrics | TV loss, fidelity, fake ΔE | mean/max position error, % within 1 px, shape loss |
| headless test | none | `test/roundtrip.test.mjs` |

## Picked from `main`

1. **Palette snap** (`refineReverseColors` → `snapColorToCell`).
   8-bit RGB cannot encode every (h, s) pair, so an emitted color came back
   to the wrong diagram pixel about half the time. Each color is now searched
   over the ±2 RGB cube (ordered center-out) for the variant that returns to
   the pixel it came from. Adapted to this branch's per-cell pipeline:
   snapped lazily, once per *source cell*, reused for the whole run of output
   pixels that sample it — so the cost scales with the drawing, not the
   mosaic. Mean displacement 0.53 px → 0.15 px, 100% of pixels within 1 px.

2. **Exact source path** (`currentImageExact`).
   The direct pipeline used to rescale every source with smoothing, which
   blends two palette colors into a third that belongs somewhere else on the
   disc. The reverse mosaic is flagged exact: passed through 1:1 when it fits
   the pixel budget, nearest-neighbor otherwise.

3. **Mosaic sized to the pixel budget.**
   Was a fixed 320×240 = 76,800 px, i.e. always above the default 50,000
   budget and therefore always resampled. Now `floor(sqrt(N·4/3)) ×
   floor(N / that)`, which fills ≥97% of the budget at every slider stop and
   lets the exact path actually trigger.

4. **Real roundtrip metrics.** `ΔE` was `lossPercent / 100 * 0.25` — a number
   derived from another number. It is now a real CIE76 ΔE between the
   diagram's own color and the emitted one, and a **Position Error** row was
   added (mean px · % within 1 px), which is the metric that actually says
   whether a shape survives.

5. **`test/roundtrip.test.mjs`.** Rewritten for this branch: it extracts the
   real `convertReverseHslToImage` plus the snap helpers out of `index.html`,
   runs them against a stub canvas, rasterizes the Spiral Lineart preset and
   asserts the bounds. 14 checks.

## Fixed along the way (not from `main`, but exposed by the comparison)

**Guide-free source canvas.** The reverse pass read the *visible* diagram,
which also carries the coordinate guide. The 25% / 50% / 75% / 100%
saturation rings composite to luminance ≈27 over the `#0c0c0f` background —
just above the pass's own `lum < 24` cutoff — so roughly 5% of every
lineart's mass was actually guide furniture, injected as near-black
low-lightness colors. Linearts and heightmaps are now painted on a separate
transparent canvas and only composited over the guide for display; the
reverse pass reads the clean copy. Antialiased stroke edges are weighted by
their alpha instead of being read as blended-with-background colors.

## Deliberately not picked

- **Segmented Direct/Reverse toggle + grayscale heightmap diagram view.**
  This branch keeps a live HSL diagram and a live image at all times with no
  mode to be in; the toggle would trade that away.
- **Shuffled mosaic.** `main` shuffles so the output cannot be mistaken for a
  spatial reconstruction. Here the serpentine order is the input to the
  Monte-Carlo relaxation, which this branch has and `main` does not.
- **`binPixelsToHeightmap`.** It exists to make `main`'s toggle lossless in
  both directions. Here the cycle already closes through the real diagram:
  reverse reads whatever the direct pipeline painted.

## Result (spiral lineart, 50k pixels, `node test/roundtrip.test.mjs`)

| metric | before | after |
|---|---|---|
| mean position error | 0.531 px | **0.151 px** |
| max position error | 1.41 px | **1.00 px** |
| pixels within ≤1 px | 93.9% | **100%** |
| exact-cell returns | 49.4% | **84.7%** |
| shape loss (7 px bins) | 3.89% | **2.17%** |
| per-pixel loss | 50.2% | **20.5%** (5.6% is the sampling floor) |
