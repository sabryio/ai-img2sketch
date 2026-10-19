# Parity

## Why this document exists

The Rust port is mechanical. The picture is not. Two implementations that both "draw the frames" will
disagree in the flat regions first — the adaptive threshold is a knife edge, and a resize that rounds
one least-significant bit the other way moves pixels across it. A port that produces a *similar*
sketch is not a port; it is a second product.

So parity gets a contract, a fixture set and a comparison command, and it exists **before** the first
line of Rust. Phase 0 of [`ROADMAP.md`](../ROADMAP.md) is spent making the comparison runnable against
the Python engine, so that when Rust arrives, "same output" is a report and not a debate.

## What is frozen

Each golden is a **case**: one source image, one configuration, one set of outputs.

| Case | Source | Overlay | Why it is in the set |
|---|---|---|---|
| Plain drawing | `images/cartoon.png` | none | The baseline path: grid, ordering, threshold, encode, no compositing |
| Large drawing | `images/stage.png` | none | Bigger canvas, more cells, resize rounding under load |
| Flat regions | `images/2.png` | none | Large areas of near-constant colour — where threshold disagreement shows up first |
| Hand overlay | `images/drawing-hand.png` + `images/hand-mask.png` | hand + mask | Per-frame compositing, mask geometry, the alpha path |
| Object masks | `images/2.png` + `images/example-object-masks.json` | none | Ordered-mask drawing, unlisted-cell ordering, skip-rate interaction |
| Final-frame colour | any of the above, `--end-duration 2` | — | The colour tail of the video, which takes a different code path than the sketch |
| Degenerate | a single-cell image, skip rate above the cell count, `--end-duration 0` | — | The floor: a run must still write at least one frame |

Configurations are pinned explicitly — grid split, frame rate, skip rate (or target draw duration),
end duration, hand assets — and written into the manifest. A case is only meaningful if its inputs are
recorded; a golden with an unrecorded config is a picture, not a test.

For each case the manifest records:

- the source path and its SHA-256, plus every overlay asset's hash
- the resolved configuration, after defaults
- output dimensions, frame count, frame rate, duration
- the encoder settings in effect (`libx264`, crf 18, veryfast, `yuv420p`, `+faststart`)
- the SHA-256 of each stored artifact

## Artifacts

| Artifact | Format | Purpose |
|---|---|---|
| Thresholded grid | PNG, lossless | The parity-critical image; compared per pixel |
| Final frame | PNG, lossless | The colour tail, compared per pixel |
| Produced video | MP4 | Decoded and compared frame by frame, not byte by byte |
| Manifest | JSON, committed | The record above; the only part that is tracked |

Goldens live under `fixtures/golden/` and are **git-ignored** except the manifest — the artifacts are
regenerable from the sources, and a repository should not carry megabytes of PNG for a comparison
anyone can re-run. Add `fixtures/golden/*/` to `.gitignore` alongside the existing `*.mp4` rule.

## How goldens are produced

One documented command runs the Python engine over every case at its pinned configuration and writes
the artifacts plus the manifest:

```
task golden          # regenerates fixtures/golden/ from images/ using the Python engine
task parity          # compares a build against fixtures/golden/ and reports
```

Regeneration is deliberate and rare: it happens when drawing behaviour is *intentionally* changed,
and the resulting manifest diff is reviewed like any other change to behaviour. Regenerating to make a
failure go away is the one thing this document exists to prevent.

## Comparison rules

### Identical, or the phase fails

| Compared | Rule |
|---|---|
| Thresholded grid (per case) | Byte-identical PNG pixels. Any differing pixel is a defect until explained *and* accepted into the ledger below |
| Final frame (per case) | Byte-identical pixels |
| Frame count | Equal |
| Dimensions | Equal |
| Frame rate | Equal |
| Duration | Equal to within one frame |
| Encoder settings | Equal (codec, pixel format, faststart) |
| Exit behaviour and messages | Equal where the tests assert them |

### Equivalent, within a stated tolerance

| Compared | Metric | Tolerance |
|---|---|---|
| Decoded video frames | PSNR | ≥ 40 dB against the golden MP4 |
| Decoded video frames | SSIM | ≥ 0.99 |
| Preview stills | PSNR | ≥ 35 dB — they are ephemeral JPEGs whose only job is to stream to the UI |
| File size | Ratio to golden | Within ±15 % (encoder framing differences, not quality) |

The tolerance exists because *no two encoders produce the same bytes* — not because the picture is
allowed to drift. If a decoded frame falls below the PSNR floor, that is a defect in the pipeline, not
in the encoder.

### The ledger

An accepted difference must be written down: case, artifact, how many pixels or how many decibels,
the cause if known, and the decision. If this list grows past one or two entries, the threshold
implementation is wrong and should be fixed rather than excused.

| Case | Artifact | Difference | Cause | Decision |
|---|---|---|---|---|
| 397×303 cartoon, split 10, skip 8 | Thresholded grid | 255 pixels of 120 000; 617 ink cells against 615 | OpenCV resizes and blurs in fixed point, this port uses `f64` and rounds once: ±1 LSB on the pixels where the two roundings disagree | **Open.** Either emulate OpenCV's fixed-point kernels exactly, or record it here as accepted. See below for what it costs |

## Measured: the Rust engine against the Python engine

First end-to-end comparison: `images/cartoon.png` scaled to 397×303 — a canvas that is a multiple of
the split length in neither direction, so the resize has to do real work — drawn with `--split-len 10
--frame-rate 10 --object-skip-rate 8 --end-duration 1`.

| Stage | Compared | Result |
|---|---|---|
| Canvas | `cv2.resize(INTER_AREA)` vs `images/resize.rs` | 90 % of pixels identical, the rest exactly 1 apart |
| Greyscale | `cv2.cvtColor` vs `to_grayscale` | 90 % identical, the rest 1 apart |
| Local mean | `cv2.GaussianBlur(15, σ≈2.6, replicate)` vs `gaussian_blur` | 1 apart at most, everywhere |
| Threshold | `cv2.adaptiveThreshold` vs `gaussian_adaptive_threshold` | 255 of 120 000 pixels differ (0.2 %); 617 inked cells against 615 |
| Drawing route, **same** thresholded image | the Python loop fed the Rust canvas | **frame count equal (87), SSIM ≥ 0.9946, median 0.9979** |
| Decoded video, Python engine vs Rust engine | per-frame PSNR / SSIM | PSNR min 6.7 dB, median 15.3 dB; SSIM min 0.543, median 0.869 |

The last two rows are the finding, and it is worth stating plainly rather than burying it.

**Given the same thresholded image, the two engines are the same engine.** Running the *Python*
drawing loop on the *Rust* canvas reproduces the Rust video: same frame count, frames agreeing to
SSIM 0.998. Grid arithmetic, cell ordering, the nearest-neighbour route, hand placement and the
frame-count arithmetic are matched.

**One least-significant bit in the canvas costs nearly all of the video's similarity.** The route is
a greedy nearest-neighbour walk, and it is chaotic: add or remove one inked cell and the walk takes a
different turn, so at frame *k* the two videos have drawn a different *set* of cells while both are
drawing the same picture. They converge again by the end — the final frames agree to 41.9 dB — and
the whole difference lives inside the 0.2 % of threshold pixels that flip.

The cause is arithmetic rather than algorithm: OpenCV resizes and blurs in fixed point, this port
carries `f64` and rounds once, and the two disagree by one where their roundings disagree. Closing it
means reimplementing OpenCV's fixed-point kernels exactly — `resizeArea_`'s integer weights and the
kernel quantisation inside `sepFilter2D` — and then the *threshold* is identical and the route with
it. That is a real piece of work, and it is the only known route to a green `task parity`.

Two things that look like the same bug and are not:

- **A zoom is still an area average.** OpenCV documents `INTER_AREA` when zooming as "similar to
  `INTER_NEAREST`", which invites the reading that the zoom case is plain nearest. It is not: a
  destination interval narrower than a source pixel takes that pixel whole and mixes with its
  neighbour only where it straddles the boundary. Growing `[0, 10, 20]` to seven pixels gives
  `[0, 0, 7, 10, 13, 20, 20]`, and reading the documentation the obvious way gives
  `[0, 0, 10, 10, 20, 20, 20]` — wrong by a pixel width at every straddle. Deciding the axis's
  behaviour by comparing lengths is the trap; the interval arithmetic handles both cases by itself.
- **`cv2.GaussianBlur(src, (15,15), 0, 0, cv2.BORDER_REPLICATE)` does not mean what it looks like.**
  The fourth positional argument is `dst`, not `sigmaY`, so that call blurs with `sigmaY = 1.0` and
  the *default* border, and comparing against it manufactures a 46-LSB "disagreement" that is not
  there. Use `cv2.GaussianBlur(src, (15,15), 0, None, 0, cv2.BORDER_REPLICATE)`.

## Diagnosing a failure

When parity fails, the report names the case and the artifact, and produces a diff image: pixels that
differ are marked on a copy of the golden, so the shape of the disagreement is visible at a glance.

| What the diff looks like | Where to look |
|---|---|
| Speckle across flat areas | Adaptive threshold: block size, the Gaussian weight, or the constant |
| A shifted or rescaled edge | Resize rounding, or the greyscale coefficients |
| Whole cells wrong | Grid calculation or cell ordering |
| One region, bounded by the mask | Hand overlay blending, mask interpretation, or object-mask ordering |
| Last frames wrong only | The final-frame path and its frame-count arithmetic |
| Video differs but thresholded frames match | The encoder adapter or the arguments it passes |

## Wiring

- `task parity` is the single entry point; it builds the workspace, runs every case, and prints a
  table: case, artifact, verdict, metric.
- It runs at every phase gate from Phase 2 onward, and it is the gate that lets Python be retired.
- Before Rust exists, `task parity` compares the Python engine against its own goldens. That run is
  expected to be green and is how the harness earns trust.

## What parity does not cover

- **Playback.** Decoding the MP4 in a script proves the bytes; it does not prove the webview plays
  them. That stays with the Edge playback probe, because Playwright's bundled Chromium cannot decode
  H.264 — the same probe the H.264 change was verified with.
- **The interface.** Parity says the engine draws the same video; the Playwright suite says the app
  still behaves. Both are needed, and they are separate gates.
- **Performance.** Parity is about correctness. Throughput is measured afterwards, against a baseline
  captured before the port, and only then optimised.
