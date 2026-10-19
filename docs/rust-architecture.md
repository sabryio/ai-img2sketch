# Rust Target Architecture

## Purpose

This document describes the engine, the API and the CLI as a Rust workspace that serves **the same
HTTP contract** the Python implementation serves today. It is the design behind
[`ROADMAP.md`](../ROADMAP.md); the phased work and the gates live there.

The frontend is out of scope. It keeps talking HTTP to `127.0.0.1:8000` and cannot tell which language
answers. That constraint is what makes the port verifiable: the contract has a test suite already, so
the port has an acceptance gate that is not an opinion.

For the design of the engine as it exists today, see [`ARCHITECTURE.md`](../ARCHITECTURE.md). The
layering, the port boundaries and the responsibilities in that document are not being reinvented
here; they are being re-expressed in a language with fewer runtime seams.

## Invariants

Nothing in this list is negotiable during the port. Each one has either a test or a document behind
it, and a Rust implementation that changes one is a bug, not a decision.

| Invariant | Enforced by |
|---|---|
| Route paths under `/api/v1`: `/health`, `/media`, `/sketches`, `/sketches/batch`, `/artifacts/download`, `/artifacts`, `/events` | [`docs/api.md`](api.md), the e2e suite |
| JSON field names and nesting in every request and response | [`docs/api.md`](api.md), the e2e suite |
| SSE frame syntax and event catalogue | [`docs/orpc-sse-wire-format.md`](orpc-sse-wire-format.md) |
| Error mapping (HTTP status per failure class, and the same class in the SSE failure event) | [`docs/api.md`](api.md) |
| Binary names `img2sketch` and `img2sketch-api` | `docker-compose.yml`, `docs/tauri-integration.md` |
| `APP_*` environment variables and their defaults | `docker-compose.yml`, the settings screen |
| Uploads land at `<media>/uploads/<bucket>/<name>-<hex8>.<ext>` | the frontend's path regex, the e2e suite |
| Live previews at `<media>/previews/<run-id>/`, referenced by progress events, deleted when the run ends | the frontend, the e2e suite |
| Artifacts live under the media or output root and are refused otherwise | `docs/api.md` errors, the e2e suite |
| Nothing persists after the run: uploads, previews and produced videos are all removable, and removal is the point | `PRODUCT.md`, the e2e suite |
| Single process, single event loop's worth of concurrency: one event bus shared by handlers and subscribers | `docker-compose.yml`'s single-worker comment |
| The result must play in the webview | the H.264 requirement, the Edge playback probe |

## Workspace layout

```
Cargo.toml                       workspace, shared lint and profile settings
crates/
  img2sketch-core/               domain + application + pure services; no I/O, no async
    src/domain/                  dimensions, video_config, image, hand, object_mask, video
    src/services/                dimension_adjuster, grid_calculator, drawing_path_calculator,
                                 drawing_planner, drawing_speed, hand_overlay, video_path_resolver
    src/use_cases/               generate_sketch_video, generate_batch_videos
    src/ports.rs                 the traits that still earn their keep
  img2sketch-media/              adapters: image I/O, preprocessing, encoder, storage, previews
  img2sketch-api/                axum app, routers, SSE, schemas          → bin img2sketch-api
  img2sketch-cli/                clap surface                             → bin img2sketch
desktop/                         Tauri v2 host (new in this port)
tests/ (per crate)               unit tests beside the code; integration under tests/
fixtures/golden/                 git-ignored parity artifacts + committed manifest
```

**Dependency direction.** `api` and `cli` depend on `media`, which depends on `core`. `core` depends
on nothing outward — no filesystem, no clock beyond what is passed in, no async runtime. This is the
existing hexagon with the arrows drawn the same way; the composition root that wires the adapters
becomes plain constructor calls in `main`.

## What happens to the ports

The Python ports exist for two reasons: to satisfy the dependency rule, and to be faked in tests.
Rust keeps both reasons, so the traits map across nearly one-to-one — but the ceremony around them
goes away.

| Today | Rust |
|---|---|
| `ImageLoader`, `HandLoader`, `ObjectMaskLoader`, `ImageScanner`, `ImagePreprocessor` | traits, because the use cases are tested with fakes |
| `BlobStore`, `ArtifactReader`, `ArtifactRemover` | traits, same reason |
| `VideoWriter` + `VideoWriterFactory` | traits; the factory is a function returning `Box<dyn VideoWriter>` |
| `EventPublisher`, `EventStream` | one `tokio::sync::broadcast` channel behind a small struct |
| `ProgressReporter`, `FramePreviewPublisher` | traits with a real adapter and a null adapter, as today |
| `SketchVideoGenerator` | collapses — it was a one-implementation port around the single use case |
| `composition.py` | collapses into `main` |
| `Path` handling, `typing` protocols, `__init__` re-exports | collapse; nothing to port |

The rule to apply when it is unclear: **a trait survives if a test fakes it or a second adapter could
exist; otherwise it becomes a module.**

## Crates

Versions were read from crates.io on 19 October 2026 and are recorded so Phase 1 can pin them
deliberately rather than accept whatever resolves that day. `Cargo.lock` holds the tree afterwards.
Licences are listed because they end up in a shipped binary.

Everything below is permissive (MIT, Apache-2.0, BSD-2-Clause, Zlib, Unlicense). The single
GPL-adjacent component remains **libx264 inside the encoder**, which is what the project already
links through PyAV today — the port does not change the licence position in either direction.

### `img2sketch-core` — pure, no I/O, no async

| Crate | Version | Licence | Used for |
|---|---|---|---|
| `serde` | 1.0.229 | MIT OR Apache-2.0 | Derives on the domain types; the wire names are the field names |
| `thiserror` | 2.0.21 | MIT OR Apache-2.0 | A typed error enum per failure class, so the API can map status codes exhaustively |

That is the whole dependency set. Anything else in this crate is a signal that the pure layer has
grown an edge it should not have.

### `img2sketch-media` — adapters: pixels, files, encoding

| Crate | Version | Licence | Used for |
|---|---|---|---|
| `image` | 0.25.10 | MIT OR Apache-2.0 | Decode and encode PNG/JPEG/WebP/GIF/TIFF/BMP; EXIF orientation (OpenCV applies it, so parity requires it) |
| `fast-image-resize` | 6.1.0 | MIT OR Apache-2.0 | The `INTER_AREA` equivalent, with SIMD. Package name has hyphens, the import is `fast_image_resize` |
| `rayon` | 1.12.0 | MIT OR Apache-2.0 | Optional: parallel composition across cells. Added only if it measures |
| `bytemuck` | 1.25.2 | Zlib OR Apache-2.0 OR MIT | Zero-copy casts between `image` buffers and the flat pixel slices the drawing loop wants |
| `walkdir` | 2.5.0 | Unlicense/MIT | The folder scan for batch mode — depth-1 today, recursive whenever that option lands |
| `uuid` | 1.28.0 | Apache-2.0 OR MIT | The `-<hex8>` upload suffix and the preview run directory (`v4` feature) |
| `tempfile` | 3.27.0 | MIT OR Apache-2.0 | Write-then-rename for uploads and finished videos, so a half-written file is never servable |
| — | — | — | **The encoder adds no crate under the recommended option**: a bundled `ffmpeg` is invoked with `std::process::Command` on the blocking thread that already owns the render |

### `img2sketch-api` — the axum server

| Crate | Version | Licence | Used for |
|---|---|---|---|
| `axum` | 0.8.9 | MIT | Routing, extractors, `Sse`; features `json`, `multipart` |
| `tokio` | 1.53.3 | MIT | The runtime; features `rt-multi-thread`, `macros`, `net`, `fs`, `sync`, `signal` |
| `tower` | 0.5.3 | MIT | Middleware composition; `ServiceExt::oneshot` in endpoint tests |
| `tower-http` | 0.7.1 | MIT | CORS, static-file serving, request tracing, body limits |
| `bytes` | 1.12.1 | MIT | Buffers for streaming a produced video back |
| `tokio-util` | 0.7.20 | MIT | `io::ReaderStream` — stream a file to the client without holding it |
| `tokio-stream` | 0.1.19 | MIT | `BroadcastStream` — the event bus rendered as SSE frames |
| `futures-util` | 0.3.34 | MIT OR Apache-2.0 | Stream adapters between the two above |
| `mime_guess` | 2.0.5 | MIT | Content types for artifacts and preview stills |
| `httpdate` | 1.0.3 | MIT OR Apache-2.0 | Cache headers on preview stills, which must never be cached |
| `urlencoding` | 2.1.3 | MIT | Encoding file paths into preview URLs |
| `serde` / `serde_json` | 1.0.229 / 1.0.154 | MIT OR Apache-2.0 | Request and response bodies |
| `uuid` | 1.28.0 | Apache-2.0 OR MIT | As in `media` |
| `thiserror` | 2.0.21 | MIT OR Apache-2.0 | The error enum rendered to the statuses in `docs/api.md` |
| `anyhow` | 1.0.104 | MIT OR Apache-2.0 | `main` only: startup context. Never in a handler |
| `tracing` / `tracing-subscriber` | 0.1.44 / 0.3.23 | MIT | Logging at `APP_LOG_LEVEL` |

`hyper`, `multer` and `http` arrive transitively through `axum` and `tower-http`; nothing calls them
directly.

### `img2sketch-cli`

| Crate | Version | Licence | Used for |
|---|---|---|---|
| `clap` | 4.6.7 | MIT OR Apache-2.0 | The surface, `derive` feature |
| `indicatif` | 0.18.6 | MIT | The drawing progress bar |

No `tokio`: the use cases are synchronous, so the CLI calls the engine directly and prints. Parity is
about the lines the tests assert, not the bar above them.

### `desktop/` — the Tauri v2 host

| Crate | Version | Licence | Used for |
|---|---|---|---|
| `tauri` | 2.12.4 | Apache-2.0 OR MIT | The v2 app; WRY/WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux |
| `tauri-build` | 2.7.3 | Apache-2.0 OR MIT | Build-dependency in `build.rs` |
| `tauri-plugin-shell` | 2.5.0 | Apache-2.0 OR MIT | Spawning and supervising the `img2sketch-api` sidecar |
| `tauri-plugin-dialog` | 2.8.3 | Apache-2.0 OR MIT | The native pickers the UI already calls through `@tauri-apps/plugin-dialog` |
| `reqwest` | 0.13.5 | MIT OR Apache-2.0 | Polling `/api/v1/health` to know when the engine is up |
| `tokio` | 1.53.3 | MIT | v2's runtime is tokio; used for the polling loop and child supervision |
| `serde` / `serde_json` | 1.0.229 / 1.0.154 | MIT OR Apache-2.0 | Reading the mode/config the host needs at boot |

**Tauri v2 specifics that are already decided by the contract.**

- The sidecar is declared as `bundle > externalBin: ["binaries/img2sketch-api"]`, and the file on disk
  must be `img2sketch-api-<target-triple>`. Tauri strips the triple when it installs it, which is how
  the name users see stays `img2sketch-api`.
- The shell plugin's v2 capability model requires an ACL entry in `capabilities/`
  (`shell:allow-execute`, scoped to that sidecar) before the host may spawn it.
- The host passes the `APP_*` variables to the child and lets it bind port 8000, so the origin the UI
  and the settings screen already know does not move.
- v2 development runs Vite on 1420 while `frontend/` runs on 3000; both are already in the CORS
  defaults, and `tauri.localhost` / `tauri://localhost` cover the packaged webview.
- **Playback is a webview question, not a codec question.** WebView2 is Edge and decodes H.264, and
  WKWebView does too, which is why the playback probe uses Edge. WebKitGTK on Linux may lack H.264
  unless the gstreamer `libav`/`openh264` plugins are present — so Linux playback gets its own
  verification pass rather than an assumption.

### Tests and benchmarks

| Crate | Version | Licence | Used for |
|---|---|---|---|
| `tempfile` | 3.27.0 | MIT OR Apache-2.0 | Scratch directories |
| `assert_cmd` / `predicates` | 2.2.2 / 3.1.4 | MIT OR Apache-2.0 | CLI tests that assert the exact messages |
| `axum-test` | 21.1.0 | MIT | Endpoint tests against a real listener — the analogue of FastAPI's `TestClient` |
| `reqwest` | 0.13.5 | MIT OR Apache-2.0 | SSE streaming tests against a real server (the same reason Python's `TestClient` could not stream) |
| `tower` | 0.5.3 | MIT | `oneshot` requests in-process, for the tests that need no socket |
| `image-compare` | 0.5.0 | MIT | PSNR and SSIM for the parity harness |
| `sha2` / `hex` | 0.11.1 / 0.4.3 | MIT OR Apache-2.0 | The manifest's content hashes |
| `openh264` | 0.9.9 | BSD-2-Clause | An **independent** decoder, so the produced MP4 is verified by a different library than the one that wrote it — exactly what the Python suite does by decoding PyAV's output with OpenCV |
| `proptest` | 1.12.0 | MIT OR Apache-2.0 | Properties for the grid and dimension maths |
| `insta` | 1.49.0 | Apache-2.0 | Snapshots for SSE frames and JSON bodies |
| `criterion` | 0.8.2 | Apache-2.0 OR MIT | The throughput baseline captured after parity, before any optimisation |

### Build tooling, not dependencies

| Tool | Version | Licence | Used for |
|---|---|---|---|
| `cross` | 0.2.5 | MIT OR Apache-2.0 | Cross-compiling the Linux target from any host |
| `cargo-zigbuild` | 0.23.4 | MIT | The static-musl build for the container, without a full cross toolchain |
| `rust-toolchain.toml` | — | — | Pins the compiler so CI and the dev machine agree |

### Deliberately not used

| Crate | Why not |
|---|---|
| `opencv` (0.101.1) | Bindings to the same C++ library the port exists to leave behind; it would drag the GUI stack and the system OpenCV back in |
| `ndarray` (0.17.2) | Not needed once pixel buffers are flat `Vec<u8>` / `ImageBuffer` |
| `actix-web`, `rocket`, `warp` | `axum` is the tower/tokio-native choice here and matches what the Tauri side already speaks |
| `sqlx`, `diesel` | Nothing persists, by design |
| `ffmpeg-next` (9.0.0) / `ffmpeg-sys-next` (9.0.1) | Needs a per-platform FFmpeg build and a WTFPL/LGPL/GPL licence tangle; revisit only if the subprocess shows up in a profile |
| `mp4` (0.14.0) | Only relevant if the pure-Rust encoder path is taken; it also writes the container, so faststart becomes our problem |
| `imageproc` (0.27.0) | Its adaptive threshold is a box mean or median, not OpenCV's Gaussian local mean — the operator we must not substitute |
| `num-traits`, `mimalloc`, `jemallocator` | Speculative. Allocators and generic maths are a post-parity measurement, not a guess |

## Data model

Domain types become plain structs and enums with `serde` derives whose field names match the API
exactly (`output_path`, `preview_path`, `percent`, `frame`, `total_frames`, `error`, `succeeded`,
`total`, …). `docs/api.md` is the authority for the wire names, and the wire names are never derived
from Rust naming conventions — a rename in Rust that changes JSON is a contract break.

Value objects keep their invariants: dimensions validate and normalise to even values for the
encoder, video config validates its ranges, an object mask is a set of cells rather than a bitmap
where the current code treats it that way.

## Concurrency model

The Python server is single-worker on purpose: the event bus is in-process. Rust keeps that shape and
loses the reason it was a constraint.

- `tokio` drives axum. The render path is CPU-bound and synchronous, so it runs off the reactor — on a
  `spawn_blocking` task (or a dedicated worker thread) — leaving the reactor free to stream SSE
  progress while frames are being drawn. Today this is the same behaviour with more machinery.
- The event bus is one `broadcast::Sender`. Whatever replay or late-subscriber semantics
  [`docs/orpc-sse-wire-format.md`](orpc-sse-wire-format.md) defines are reproduced exactly; the
  document, not the Python code, is the specification.
- **Frame pipeline.** Compose frame `n+1` while the encoder writes `n`, through a small bounded
  channel. This is the honest speed win of the port: the heavy work is already native C, so the gain
  is in overlapping composition with encoding and removing per-frame buffer churn, not in the
  arithmetic. Composition across cells may use `rayon` if it measures well; it is an optimisation, not
  an assumption.
- **Cancellation.** There is none today — a render request blocks until it finishes — so none is
  added. If the contract ever grows a cancel endpoint, it belongs in the roadmap, not in the port.

## The image pipeline

The parity-critical operations, and what to be afraid of:

| Step | Python | Rust | Notes |
|---|---|---|---|
| Decode | `cv2.imread` | `image::open` | Verify colour order (`cv2` hands back BGR) and EXIF orientation |
| Resize | `cv2.resize(..., INTER_AREA)` | `fast_image_resize` (Area) | Rounding can differ by a least-significant bit |
| Greyscale | `cv2.cvtColor` | `image`'s luma conversion | Must match the coefficient set, not just look right |
| Threshold | `cv2.adaptiveThreshold(..., GAUSSIAN_C, ...)` | **own implementation** | No drop-in equivalent exists; this is the highest-risk item in the port |
| Mask/overlay | NumPy alpha blending | plain pixel loops or a small LUT | The hand overlay is per-frame work; keeping it allocation-free is the point |
| Preview stills | `cv2.imwrite` JPEG | `image` JPEG encoder | Ephemeral, wiped at run end — approximate parity is enough |
| Encode | PyAV / libx264 | see below | |

`cv2.adaptiveThreshold` with `GAUSSIAN_C` subtracts a Gaussian-weighted local mean before
thresholding. `imageproc`'s adaptive threshold is a box mean or median, which is a *different picture*
in flat regions. The Rust implementation computes the Gaussian local mean with the same block size
and constant, then thresholds, and the golden harness decides whether it matches per pixel. Do not
substitute a "visually similar" operator and call the phase done.

## The encoder decision

The product requirement is that the finished video **plays where it is watched** — the Tauri webview
— which is why the project moved to H.264. Any Rust choice has to keep that true.

| Option | Output vs today | Cost | Verdict |
|---|---|---|---|
| **Bundle a static `ffmpeg` binary and invoke it with the arguments already in use** (`libx264`, crf 18, veryfast, `yuv420p`, `+faststart`) | Same encoder, same settings | One ~40 MB binary per platform, one process spawn per video (tens of milliseconds) | **Recommended for the port.** The encoder is not the thing being rewritten; keeping it identical removes a whole risk axis |
| Link FFmpeg (`ffmpeg-next` / `ffmpeg-sys-next`) | Same | Owning per-platform FFmpeg builds — pkg-config or vcpkg, GPL x264, CI toolchains for three targets | Later, if the subprocess ever shows up in a profile |
| Pure-Rust path (`openh264` + an MP4 muxer crate) | Different: bitrate rate control instead of CRF, plus container layout and faststart written by hand | Smallest and most self-contained; BSD licensed | Attractive once the golden harness can prove the retuned output is as good — a follow-up, not the first cut |

The adapter keeps the same shape regardless of which option wins: `write_frame`, then a `release` that
drains the encoder before closing. The choice is contained entirely inside `img2sketch-media`.

## API layer

axum with `tower-http` for CORS and file serving. The route table, the response shapes and the error
mapping come from [`docs/api.md`](api.md) and are reproduced, not reinterpreted.

| Concern | Approach |
|---|---|
| Multipart upload staging | Stream into `<media>/uploads/<bucket>/<name>-<hex8>.<ext>`; sanitise the client filename; the `-<hex8>` suffix is part of the contract, not an implementation detail |
| Artifact download | `Content-Disposition` as attachment or inline, matching today's behaviour for previews vs finished videos |
| Artifact delete | Refuse anything outside the served roots, with the same status the Python API returns |
| SSE | axum's `Sse` response, frames written exactly as [`docs/orpc-sse-wire-format.md`](orpc-sse-wire-format.md) specifies |
| CORS | The same five default origins (Tauri dev 1420, dev server 3000 on both loopback spellings, `tauri.localhost`, `tauri://localhost`), overridable by `APP_CORS_ORIGINS` |
| Health | `GET /api/v1/health`, the container's healthcheck |
| Errors | One enum per failure class, rendered to the status and body `docs/api.md` documents |

## Configuration

Loaded from the environment at the process edge, exactly as today — the Docker and Tauri wiring stays
declarative.

| Variable | Default | Meaning |
|---|---|---|
| `APP_HOST` | `0.0.0.0` | Bind address |
| `APP_PORT` | `8000` | Bind port |
| `APP_LOG_LEVEL` | `info` | Tracing filter |
| `APP_CORS_ORIGINS` | the five origins above | JSON list |
| `APP_MEDIA_DIR` | `media` | Uploads, previews; the container's `/app/media` |
| `APP_OUTPUT_DIR` | `output` | Produced videos; the container's `/app/output` |

## CLI

`clap`, matching the current surface option for option, default for default, and message for message.
The messages are what the tests assert — "Video saved to: …" and friends are output, not prose, and
they are part of parity.

## Packaging

**Container.** Multi-stage: a Rust builder, then a minimal runtime. The final layer is tens of
megabytes instead of 1.05 GB, and drops `libgl1`, `libglib2.0-0`, `libsm6` and `libxext6` — none of
which are needed once nothing loads OpenCV's GUI path. Keep what the contract depends on: uid/gid
10001, `/app/media` and `/app/output`, the tmpfs volume semantics, the healthcheck against
`/api/v1/health`, and a single process so the in-process event bus stays coherent.

**Desktop.** `desktop/` is a Tauri **v2** host that spawns `img2sketch-api` as a sidecar with the
`APP_*` environment, which is what "sidecar Mode" means today with a different producer. The v2
plugin set, the `externalBin` naming rule, the ACL capability the sidecar needs and the per-webview
playback caveat are all in [Crates](#desktop--the-tauri-v2-host). Running the engine in-process —
linking the API crate and letting the host own the listener — is a later optimisation; it changes
nothing about the contract, so it can wait until it is convenient.

## Testing

| Layer | What it proves |
|---|---|
| Unit tests beside each module | The algorithms and the services, ported from the Python tests that carry behaviour |
| `img2sketch-media` integration tests | Encoding, decoding with an independent library, file layout, cleanup |
| Golden parity tests | The picture is the picture — see [`docs/parity.md`](parity.md) |
| API tests | Route shapes and error mapping against `docs/api.md` |
| Playwright suite, unchanged | The contract, end to end, through the real UI — the acceptance gate |

Tests that only asserted `__init__` re-exports, or Pydantic behaviour that Rust's type system makes
impossible to violate, are not ported. Everything that asserts observable behaviour is.

## Decisions and rejected alternatives

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Scope | Engine, API, CLI | Whole app in Rust | The UI is designed, tested and contracted; a Rust UI discards all three for no product gain |
| Contract | Keep HTTP | Tauri commands / IPC | The browser mode, the e2e suite and `docs/api.md` all assume HTTP; IPC would break the gate |
| Encoder | Bundled static `ffmpeg`, same arguments | Linked FFmpeg now; pure-Rust encoder now | Removes the packaging risk from the critical path while parity is established |
| Bus | `tokio::sync::broadcast` | External broker (Redis, NATS) | In-process today; a broker would add a moving part and break the single-process invariant |
| Language for the UI | TypeScript | Slint / egui / Dioxus | Tauri's design is a Rust host with a web view; the UI is supposed to be TypeScript |
| Python's fate | Kept on a tag until the e2e suite is green, then retired | Delete immediately; keep both forever | The old engine is both the fallback and the golden generator |

## Non-goals

- Changing any route, field, frame, header or string the frontend reads.
- Adding capability: no queue, no cancellation, no new formats, no plugin surface.
- Serving the frontend from the engine, bundling assets, or replacing the Vite dev server.
- **Mobile targets.** Tauri v2 can build for Android and iOS, but the workspace is a desktop one, the
  engine is a local sidecar or container, and the pickers browse the user's own filesystem — so the
  mobile scaffolding stays unused rather than becoming a supported surface.
- Optimising render throughput before parity exists. Measure after, and only then.
