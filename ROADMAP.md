# Roadmap

## Why this exists

The engine, the API and the CLI are Python today, and they work: the H.264 output plays inside the
app, the Playwright suite is green, and the container is healthy. So this is not a rescue. It is a
planned port of the **engine** to Rust behind a contract that does not move, and the reason is the
shape of the thing users have to install: a 1.05 GB container or a Python toolchain, an interpreter
at the door, and a second process to babysit.

The goal is one self-contained binary. No Docker, no Python, no virtualenv for anyone who only wants
to turn images into sketch videos — and the same HTTP contract, the same wire format, the same
frontend, the same tests.

**This roadmap covers the backend only.** The React UI, its design system and the Playwright suite
are unaffected by every phase below; if a phase seems to require a frontend change, the phase is
wrong and should be re-cut.

## Where we are

| Piece | State |
|---|---|
| Engine, API, CLI | Python 3.13, FastAPI, OpenCV, PyAV — 75 files, ~3,300 lines, ~2,100 lines of tests |
| HTTP contract | `GET /api/v1/health`, `POST /api/v1/media`, `POST /api/v1/sketches`, `POST /api/v1/sketches/batch`, `GET /api/v1/artifacts/download`, `DELETE /api/v1/artifacts`, `GET /api/v1/events` — documented in [`docs/api.md`](docs/api.md) and [`docs/orpc-sse-wire-format.md`](docs/orpc-sse-wire-format.md) |
| Output | H.264 in `yuv420p` (crf 18, veryfast, `+faststart`), written with PyAV/libx264 |
| Frontend | React 19 + Tailwind v4 + Vite, on the "Lit Sheet" visual world; 12 Playwright specs drive it against the real backend |
| Packaging | `python:3.13-slim`, uv, non-root uid 10001, tmpfs volumes, healthcheck, single uvicorn worker |
| Rust today | the workspace exists in [`rust/`](rust/README.md): `img2sketch-core` (pure), `img2sketch-media` (adapters + FFmpeg locator + subprocess encoder), `img2sketch-api`, `img2sketch-cli` — 78 tests green, `cargo clippy --workspace --all-targets` silent. The drawing loop is not ported yet |

## The end state

```
rust/crates/img2sketch-core/   pure engine: domain, ports, services, use cases
rust/crates/img2sketch-media/  image I/O, preprocessing, encoder, storage, previews
rust/crates/img2sketch-api/    axum server                                → bin img2sketch-api
rust/crates/img2sketch-cli/    clap surface                               → bin img2sketch
desktop/                       Tauri v2 host, spawning the engine as a sidecar
```

The two binary names and the `APP_*` environment variables stay as they are, so `docker-compose.yml`,
the settings screen, `docs/api.md` and the whole e2e suite keep working untouched. The container goes
from 1.05 GB to tens of megabytes, startup from roughly a second to milliseconds, and the production
image loses `libgl1` and `libglib2.0-0` entirely because nothing loads OpenCV's GUI path any more.
The dependencies each crate will pull in — versions, licences, and what was rejected — are listed in
[`docs/rust-architecture.md`](docs/rust-architecture.md#crates).

## Decisions

Locked, from the scoping conversation:

1. **Scope is the backend.** The UI stays React and the HTTP surface stays the only contract. No
   Tauri commands, no IPC rewrite: that would break the browser mode, the e2e suite, and the design
   system for no product gain.
2. **The contract is frozen.** Route paths, JSON field names, SSE frames, error mapping, the
   `-<hex8>` upload suffix, the `previews/<run>/` stills and their cleanup-on-end behaviour, the
   binary names, the `APP_*` variables.
3. **Python is retired only after the gate passes.** It lives on a tag, available as the reference
   implementation and the golden generator, and as the rollback.
4. **The H.264 toolchain: invoke an `ffmpeg` executable as a subprocess.** Not linked — every Rust
   binding crate (`ffmpeg-next`, `ffmpeg-sys-next`, `ffmpeg-the-third`) generates its bindings with
   `bindgen`, which needs libclang, which would make an LLVM toolchain a prerequisite for compiling
   this repository and a set of shared FFmpeg libraries a load-time requirement for the app. Frames
   are piped as raw `rgb24` with the arguments already in use, so the encoder is not itself a
   variable while everything else is being verified. Where that executable comes from became a
   product feature rather than a build detail: it is searched for in order of trust and reported as a
   state — found, or not; and if found, whether it can actually encode H.264. That search is
   implemented and tested in `img2sketch-media`. See
   [`docs/rust-architecture.md`](docs/rust-architecture.md#the-encoder-decision).

## Two independent tracks

| Track | Owner doc | State |
|---|---|---|
| The Rust port | this file, [`docs/rust-architecture.md`](docs/rust-architecture.md), [`docs/parity.md`](docs/parity.md) | scaffold in place ([`rust/`](rust/README.md)); goldens not yet frozen |
| The design finish (`DESIGN.md` + `.impeccable/design.json`) | [`PRODUCT.md`](PRODUCT.md), `.impeccable/` | captures taken, detector clean, finish review not yet run |

They do not block each other. The port touches no file the design track owns.

## Phases

Each phase ends at a gate that a machine checks. A phase that cannot state its gate is not ready to
start.

### Phase 0 — Freeze the goldens

**Goal.** Turn "does it look the same?" into a comparison a script can run.

**Work.** Render the repository's sample images through the current Python engine at a pinned set of
configs; store the artifacts (thresholded grid, final frame, MP4) under a git-ignored
`fixtures/golden/`, plus a committed manifest recording frame count, dimensions, frame rate, codec,
duration and content hashes. Write the comparison harness described in
[`docs/parity.md`](docs/parity.md) and run it against the Python engine itself, so the harness is
known to pass before Rust exists.

**Gate.** One documented command regenerates the goldens; the harness reports them green against the
Python engine; the manifest is committed.

**Effort.** 2–3 days.

### Phase 1 — Workspace and the pure core

**Goal.** The algorithms exist in Rust, tested, with no I/O.

**Work.** **Largely done:** the workspace, `img2sketch-core`'s domain types (dimensions with the
even-for-encoder rule and common divisors, frames with odd-side padding, video config with validated
ranges, encoder settings) and the dimension adjuster are in [`rust/`](rust/README.md). What remains
are the rest of the pure services: grid calculator, drawing path calculator, drawing planner, drawing
speed calculator, hand overlay, video path resolver — each with its ported behavioural tests. No
async, no files, no OpenCV.

**Gate.** `cargo test` green on the ported algorithm tests; the pure crate has no dependency on I/O
or async runtimes.

**Effort.** 4–6 days.

### Phase 2 — Image pipeline parity

**Goal.** The sketch is the same picture.

**Work.** The image adapters: loaders for source images, hand image and mask, object masks, the
directory scanner, the preprocessor (resize, greyscale, adaptive threshold, BGR assembly), and the
preview stills. The Gaussian adaptive threshold is the piece with no direct library equivalent and
must be implemented deliberately.

**Gate.** Thresholded output identical to the goldens on every sample image, or within the tolerance
[`docs/parity.md`](docs/parity.md) defines, with the differing pixels explained by a generated diff
image rather than waved through.

**Effort.** 3–5 days, and it is the phase most likely to overrun.

### Phase 3 — The drawing loop and the encoder

**Goal.** A real MP4 comes out of Rust.

**Work.** The single-image use case, the frame pipeline (compose `n+1` while encoding `n`), the
preview publisher and the progress reporter with the same throttle and monotonic percentages. The
batch use case follows immediately, since it reuses the same loop. The encoder adapter itself is
already written — `img2sketch-media/src/ffmpeg/writer.rs` pipes padded raw frames to an `ffmpeg`
subprocess and is verified end to end against `ffprobe` — so what is left here is the drawing loop
that feeds it.

**Gate.** Decoded frames match the golden MP4 within the metrics in
[`docs/parity.md`](docs/parity.md); frame count, dimensions, frame rate and duration are equal; the
file plays in the Edge probe that already exists.

**Effort.** 4–6 days.

### Phase 4 — The API

**Goal.** The same contract, served by Rust.

**Work.** axum application: health, media staging, artifacts (download as attachment or inline,
delete), single and batch sketches, the SSE endpoint, CORS for the webview and dev-server origins,
and the error mapping in `docs/api.md`. Storage containment rules move with it, including the
refusal semantics that keep a request from reading outside the served roots.

**Gate.** **The 12 Playwright specs pass unchanged against the Rust API.** This is the milestone the
whole roadmap exists for; a UI that has to be adjusted means the contract was not kept.

**Effort.** 5–8 days.

### Phase 5 — CLI parity

**Goal.** The tool people run by hand behaves identically.

**Work.** clap surface matching the current subcommands, options, defaults and messages; the "written
next to its image" convention; batch over a folder.

**Gate.** The CLI assertions from the current suite are ported and green against real images, and the
image-info path agrees.

**Effort.** 1–2 days.

### Phase 6 — Packaging and the desktop host

**Goal.** What users install.

**Work.** Multi-stage Docker build (Rust builder to a minimal runtime), keeping uid/gid 10001, the
`/app/media` and `/app/output` layout, the tmpfs semantics, the healthcheck and the single-process
constraint that keeps the in-process event bus honest. `desktop/`: Tauri v2 host spawning the engine
as a sidecar, wired to the existing mode switcher; an in-process engine is a later optimisation, not
part of this phase.

**Gate.** `docker compose build && up` is healthy and the e2e suite passes against the rebuilt image;
the Tauri app launches, reports engine health, and completes a render in both modes.

**Effort.** 3–5 days.

### Phase 7 — Retire Python

**Goal.** One implementation in the tree.

**Work.** Move `src/`, `tests/`, `pyproject.toml` and `uv.lock` to a tag, update `ARCHITECTURE.md`,
`README.md`, the `Taskfile` and the packaging docs, and confirm nothing references the old engine.

**Gate.** No Python in the repository; the e2e suite green; the goldens still verifiable against the
tagged engine.

**Effort.** 1–2 days.

## Risks

| Risk | Weight | Mitigation |
|---|---|---|
| Adaptive threshold (Gaussian local mean) has no drop-in equivalent | high | Own implementation, verified per-image against the goldens; this is the phase the schedule is most likely to lose |
| `INTER_AREA` rounding differences flip near-threshold pixels | medium | Golden comparison with a bounded pixel-diff allowance, and a diff image for every failure |
| The encoder toolchain becomes a build-farm problem | low | Resolved by decision 4: FFmpeg is invoked as a subprocess, so no build machine needs libclang, headers or a link step |
| Rewriting ~2,100 lines of tests is where the calendar actually goes | medium | Port behavioural tests; skip tests that only assert re-exports or Pydantic behaviour that Rust's type system removes |
| Two implementations drift while both exist | medium | The goldens and the e2e suite are the only gate; Python is retired at Phase 7 on a date, not eventually |
| Scope creep into IPC, Tauri commands or the UI | high | Decision 1 is a boundary, not a preference: HTTP stays the only contract |

## Effort

| Phase | Range |
|---|---|
| 0 Freeze the goldens | 2–3 days |
| 1 Workspace and pure core | 4–6 days |
| 2 Image pipeline parity | 3–5 days |
| 3 Drawing loop and encoder | 4–6 days |
| 4 API | 5–8 days |
| 5 CLI parity | 1–2 days |
| 6 Packaging and desktop host | 3–5 days |
| 7 Retire Python | 1–2 days |
| **Total** | **23–37 days of focused work**, more than half of it verification |

## Out of scope

- Rendering the interface in Rust (Slint, egui, Dioxus). It would discard the design system, the
  tokens and the e2e contract to buy nothing.
- Any change to the SSE wire format, JSON field names, route paths, test ids or CLI flags.
- New product capability: no queue, no cancellation endpoint, no new formats, no plugin surface.
- Rewriting the frontend build, the Playwright suite, or the `impeccable` design flow.

## Working agreement

- **One check command.** `task check` becomes `cargo fmt --check`, `cargo clippy -- -D warnings`,
  `cargo test`, and the existing e2e suite — nothing merges with a red check, as today.
- **Phase gates are merge gates.** A phase lands with its gate green, not with its code written.
- **The goldens are trunk.** Add a sample image or a config to the manifest whenever the drawing
  behaviour changes, so parity keeps meaning something.
- **Frontend untouched.** If a phase wants a component edit, stop and re-cut the phase.
