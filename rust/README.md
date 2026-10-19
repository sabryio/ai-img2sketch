# Rust workspace

The engine, the HTTP API and the CLI, being built in Rust behind the contract the Python
implementation already serves. The plan is in [`../ROADMAP.md`](../ROADMAP.md); the design and the
invariants are in [`../docs/rust-architecture.md`](../docs/rust-architecture.md).

Nothing here is wired into the app yet. The Python engine in `../src/` remains the shipping
implementation until the Playwright suite passes against this one.

## Layout, and the rule that holds it together

```
crates/img2sketch-core/    pure engine: domain, ports, services, use cases — no I/O, no async
crates/img2sketch-media/   adapters: images, FFmpeg, storage — implements core's ports
crates/img2sketch-api/     axum server                                        → img2sketch-api
crates/img2sketch-cli/     clap surface                                       → img2sketch
```

Dependencies point inward, always:

```
img2sketch-cli ─┐
                ├─> img2sketch-media ──> img2sketch-core
img2sketch-api ─┘
```

- **`img2sketch-core` is pure.** No filesystem, no network, no async runtime, no native library, no
  clock. It may not depend on `tokio`, `axum`, `image`, or `ffmpeg-next`. If a rule needs to read a
  file or ask the machine a question, the *question* is a port here and the *answer* is an adapter in
  `img2sketch-media`.
- **`img2sketch-media` never depends on a presentation crate.** It knows nothing about HTTP or
  argument parsing.
- **`img2sketch-api` and `img2sketch-cli` hold no business rules.** They translate a request into a
  use case call and a use case result into a response.
- **One responsibility per type; depend on abstractions.** Ports are traits, adapters implement them,
  and no adapter is constructed inside the code that uses it.

Two tests enforce this rather than trusting it:
`crates/img2sketch-core/tests/architecture.rs` and `crates/img2sketch-media/tests/architecture.rs`.

## Building

```powershell
cargo check --workspace      # fast
cargo test  --workspace
cargo clippy --workspace --all-targets
cargo fmt   --check
```

`rust-toolchain.toml` pins the compiler, so the version in this repository is the version in CI.

## FFmpeg

**Building the workspace needs nothing but `rustc`.** FFmpeg is not linked: every Rust binding crate
(`ffmpeg-next`, `ffmpeg-the-third`, `rsmpeg`) runs `bindgen` against libclang at build time — which
would make a C++/LLVM toolchain a prerequisite for compiling this repository, and would make the
shipped app depend on the shared `avcodec`/`swscale` DLLs at load time. Instead the engine invokes an
`ffmpeg` **executable** and pipes raw frames to it.

That turns "is FFmpeg here?" into a product question rather than a build question, which is why the
locator exists and why it is in `img2sketch-media` rather than in a build script.

Where the executable is looked for, in order of trust:

| Order | Source | Where |
|---|---|---|
| 1 | `bundled` | shipped inside the app (Tauri v2 `externalBin` / resources) |
| 2 | `managed` | a copy the app installed for itself, in its own data directory |
| 3 | `configured` | a path the user chose in Settings |
| 4 | `path` | the user's `PATH` |
| 5 | `known_location` | winget/chocolatey/scoop, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/snap/bin`, … |
| 6 | `registry` | Windows `App Paths\ffmpeg.exe` |

A found executable is then asked what it is (`-version`) and whether it can do the job
(`-encoders`, looking for `libx264`) — a minimal FFmpeg without libx264 is a real failure mode, and
the app should say so rather than fail at the first decode.

For development, any FFmpeg on `PATH` is enough; `scripts/fetch-ffmpeg.ps1` downloads a build into
`rust/.tools/ffmpeg` for bundling and for running the render test.

```powershell
cargo run -p img2sketch-cli -- doctor     # says where FFmpeg is, and whether it can encode H.264
```
