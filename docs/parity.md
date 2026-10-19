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
