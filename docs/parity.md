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
| Decoded video frames | PSNR | ≥ 38 dB against the golden MP4 |
| Decoded video frames | SSIM | ≥ 0.99 |
| Preview stills | PSNR | ≥ 35 dB — they are ephemeral JPEGs whose only job is to stream to the UI |
| File size | Ratio to golden | Within ±15 % (encoder framing differences, not quality) |

The decoded-video floors exist because *no two builds of an encoder produce the same bytes* — not
because the picture is allowed to drift. The Python writer links the libx264 inside PyAV's bundled
FFmpeg; the port links none, and runs whichever `ffmpeg` the machine has. Those two disagree on
identical input by 39.4 dB and 0.992 on the reference case, which is the floor, and it is measured
rather than chosen: the ledger's control is the measurement. A case that falls below the floor is a
defect in the pipeline; a case that lands on it is the encoder. **The comparisons that decide parity
are the pixel ones, where the answer is zero — the video floors only catch a pipeline that has
stopped encoding what it drew.**

### The ledger

An accepted difference must be written down: case, artifact, how many pixels or how many decibels,
the cause if known, and the decision. If this list grows past one or two entries, something is wrong
and should be fixed rather than excused.

| Case | Artifact | Difference | Cause | Decision |
|---|---|---|---|---|
| Every case | Thresholded grid | was 255 pixels of 120 000, 617 ink cells against 615 | The port resized and blurred in `f64` where OpenCV uses fixed point | **Closed.** The resampler and the local mean are now OpenCV's arithmetic, read from its own source, and the two agree on every pixel. See below |
| Every case | Decoded video | PSNR 39.4 dB, SSIM 0.992 — and the same figures for two encodes of *identical* input | The two writers link different builds of libx264: PyAV bundles its own FFmpeg, the port runs the machine's. x264 reconstructs a hard edge according to its own threading and rate-control decisions, which differ between builds | **Accepted**, on the control below. The floor belongs to the encoder, not the engine, and no change to the port can move it |

## Measured: the Rust engine against the Python engine

`output/parity/sample.png` at 397×303 — a canvas that is a multiple of the split length in neither
direction, so the resize has to do real work — drawn by both engines at `--split-len 10
--frame-rate 10 --object-skip-rate 8 --end-duration 1`.

| Stage | Compared | Result |
|---|---|---|
| Canvas | `cv2.resize(INTER_AREA)` vs `resize_area` | **0 of 360 000 pixels differ** |
| Greyscale | `cv2.cvtColor` vs `to_grayscale` | **0 of 120 000 pixels differ** |
| Local mean | the mean inside `cv2.adaptiveThreshold` vs `gaussian_blur` | **0 of 120 000 pixels differ** |
| Threshold | `cv2.adaptiveThreshold` vs `gaussian_adaptive_threshold` | **0 of 120 000 pixels differ**; 13 750 ink cells on both sides |
| Frame count | | equal, 86 |
| Decoded video | per-frame PSNR / SSIM | PSNR min 39.5 dB, median 43.5 dB; SSIM min 0.9922, median 0.9970 |

### The preprocessing is bit-exact, and it had to be

The threshold is a knife edge and the drawing route is a chaotic greedy walk, so one pixel of the
canvas decides a whole video. The three stages are now OpenCV's own arithmetic rather than an
approximation of it:

- **`INTER_AREA` is three algorithms** and `hal::resize` picks between them by scale factor — a
  whole-block average, an overlap average with `f32` weights, and a bilinear path with 11-bit
  fixed-point weights that is used whenever *either* axis grows. Each is implemented separately, and
  the 2×2 block is averaged as `(a + b + c + d + 2) >> 2` because that is what the vector kernel
  does, which is not the same as rounding the float mean.
- **Luma is OpenCV's 15-bit integer form**, `(r*9798 + g*19235 + b*3735 + 16384) >> 15`. A
  hand-rolled `0.299r + 0.587g + 0.114b` disagrees with it on the pixels that land on a half — on
  this image, five of them, which is enough.
- **`adaptiveThreshold` does not blur the 8-bit image.** It promotes the grey image to `CV_32F`,
  blurs that with the `CV_32F` kernel, converts back, and compares. The port does the same.

### The residual is the encoder, and it is measured

A control: take the 86 frames the Python engine drew and encode **those same bytes** twice — once
through the Python writer's PyAV path, once through the command line this port builds.

| Comparison | PSNR min | SSIM min |
|---|---|---|
| Identical input, Python writer vs Rust writer | 39.44 dB | 0.9921 |
| **Python engine vs Rust engine, end to end** | **39.52 dB** | **0.9922** |

End to end comes out *better* than the control. Two encoders disagreeing this much on identical
input cannot be disagreeing about the picture, and a frame-level difference between the engines
would add to the control's difference rather than cancel it. The engine is not in this number: the
bit-exact stages above are what the engine is, and the decoded-video metric is measuring the two
libx264 builds.

That is why the decoded-video tolerance is a floor measured from the control rather than a target —
and why the comparisons that decide parity are the pixel ones, where the answer is zero.

### Rerunning it

The Rust half is an example, so the three stages can be written out at any time:

```powershell
cargo run -p img2sketch-media --example preprocess_stages -- ..\output\parity\sample.png ..\output\parity\rust-stages
```

That writes `resized.png`, `grey.png` and `thresholded.png` at 400×300. The Python half is the three
OpenCV calls the engine makes — `cv2.resize(..., INTER_AREA)` to the same canvas, `cv2.cvtColor`
with `COLOR_BGR2GRAY`, then `adaptiveThreshold(..., GAUSSIAN_C, THRESH_BINARY, 15, 10)` — and the
comparison is an absolute difference of the two, per pixel, per stage. One reading trap: `cv2.imread`
of a PNG written from a Rust `Frame` is *already* in the order the Python arrays are in — the file
holds the true red, green and blue, and `imread` reverses them into BGR, which is what the Python
engine's arrays are. Reversing the channels by hand before comparing turns a bit-exact stage into a
stage that looks entirely wrong.


Three things that look like the same bug and are not:

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
- **`-pixel_format rgb24` and `-pixel_format bgr24` do not encode the same picture.** Neither
  stream is tagged with a colour range, both are read by the same decoder, and the same frame sent
  as `rgb24` comes back with white at 255 where `bgr24` brings it back at 250 — a five-step
  difference across every pixel of the paper, worth 6 dB of PSNR and 0.15 of SSIM on its own. The
  Python writer hands libx264 `bgr24` frames, so the port declares `bgr24` and swaps the channels;
  the difference then falls to the encoder noise above. Two frames that look identical and two
  demuxer names that look interchangeable produced this, and the only way to see it was to encode
  the same bytes twice and compare.


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
