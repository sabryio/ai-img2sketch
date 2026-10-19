# Architecture Documentation

> **Status.** This document describes the engine as it exists today: Python 3.13, FastAPI, OpenCV
> and PyAV, with the Playwright suite as its behavioural contract. A port of the engine, the API and
> the CLI to Rust is under way behind a contract that does not move — the workspace scaffold is in
> [`rust/`](rust/README.md), and the Python engine here remains the shipping implementation until
> the Playwright suite passes against Rust. See
> [`docs/rust-architecture.md`](docs/rust-architecture.md) for the target design,
> [`docs/parity.md`](docs/parity.md) for how the drawing output is proven identical, and
> [`ROADMAP.md`](ROADMAP.md) for the phases and their gates. The frontend and its design system are
> unaffected either way.

## Overview

This project follows a **Clean Architecture** (Ports & Adapters / Hexagonal)
style. Dependencies point **inward**: the domain knows nothing about the
application, and the application knows nothing about infrastructure or the CLI.
The outer layers (infrastructure, presentation) depend on abstractions that the
application defines.

```
        ┌────────────────────────────────────────────┐
        │ Presentation (Click CLI + FastAPI adapters │
        │   + composition root)                      │
        │   └── depends on ──┐                       │
        └────────────────────┼───────────────────────┘
                             ▼
        ┌────────────────────────────────────────────┐
        │ Application (use cases, ports, services)   │
        │   └── depends on ──┐                       │
        └────────────────────┼───────────────────────┘
                             ▼
        ┌────────────────────────────────────────────┐
        │ Domain (entities, value objects)           │
        └────────────────────────────────────────────┘

        Infrastructure (OpenCV adapters + event bus) ── implements ──▶ Application ports
```

## Architecture Layers

### 1. Domain Layer (`src/ai_img2sketch/domain/`)

The innermost layer: the business model. It has no dependency on any other
layer, and it does not perform I/O.

#### Entities
- **Image**: an image's pixel data, dimensions and optional source path
- **Hand**: the drawing-hand image, its inverse mask and dimensions
- **Video**: the description of the video to write (path, dimensions, config)

#### Value Objects (immutable)
- **Dimensions**: width/height with validation, aspect ratio and divisor helpers
- **VideoConfig**: validated video generation settings
- **ObjectMask**: a named region (boolean raster) with an optional per-object skip rate

**Key characteristics**
- Pure: no OpenCV, no file access, no CLI
- Immutable where appropriate (`Dimensions`, `VideoConfig`, `Video` are frozen)
- Fully type-hinted; validated with Pydantic

### 2. Application Layer (`src/ai_img2sketch/application/`)

Orchestrates the domain to fulfil use cases. It depends only on the domain and
on abstractions it defines itself.

#### Ports (`application/ports/`) — the boundaries
- **ImageLoader**: load a source image
- **HandLoader**: load the drawing hand + mask
- **ImagePreprocessor**: resize/threshold an image
- **ImageDirectoryScanner**: list the images in a folder
- **ObjectMaskLoader**: load ordered object masks
- **SketchVideoGenerator**: generate one sketch video (implemented by the single-image use case)
- **VideoWriter** / **VideoWriterFactory**: write frames
- **BlobStore**: stage bytes a client uploaded and report the path they landed on
- **ArtifactReader**: resolve a produced file to a readable path, and nothing
  outside the directories the API serves
- **ArtifactRemover**: delete a staged or produced file, idempotently
- **ProgressReporter**: receive render progress without knowing about transports
  (the SSE implementation hops from the render thread back onto the event loop)

These are `typing.Protocol` definitions. The application never imports
infrastructure; infrastructure imports the ports.

#### Services (`application/services/`) — pure business logic
- **DimensionAdjuster**: rounds dimensions to a multiple of `split_len`
- **GridCalculator**: splits an image into a grid
- **DrawingPathCalculator**: nearest-neighbour drawing order
- **DrawingPlanner**: groups grid cells into ordered, per-object drawing groups
- **DrawingSpeedCalculator**: floors a target drawing duration into a skip rate
  (and estimates the duration a skip rate produces)
- **HandOverlayService**: composites the hand onto a frame
- **VideoPathResolver**: names each video after its image (`<name>.mp4`) next to
  it, or inside an explicit output directory

These are stateless and side-effect free, so they are used directly (not
injected) and are trivially unit-testable.

#### Use Cases (`application/use_cases/`)
- **GenerateSketchVideoUseCase**: loads the hand, preprocesses the image,
  draws cell by cell, writes frames and returns the output path. All I/O
  boundaries arrive via constructor injection.
- **GenerateVideosFromDirectoryUseCase**: finds every image in a folder and
  runs the single-image generator on each, writing `<name>.mp4` next to the
  source. It depends on the `SketchVideoGenerator` port (not the concrete use
  case), so it is tested with a lightweight fake. One failing image is recorded
  and does not stop the batch.

### 3. Infrastructure Layer (`src/ai_img2sketch/infrastructure/`)

Adapters that implement the application ports. Everything that touches OpenCV
or the filesystem lives here.

- **OpenCVImageLoader** implements `ImageLoader`
- **OpenCVHandLoader** implements `HandLoader`
- **OpenCVImagePreprocessor** implements `ImagePreprocessor`
- **FileSystemImageScanner** implements `ImageDirectoryScanner`
- **JsonObjectMaskLoader** implements `ObjectMaskLoader`
- **PyAVVideoWriter** implements `VideoWriter`; `create_pyav_video_writer`
  implements `VideoWriterFactory`. Frames are encoded as H.264 so the file plays
  in the app itself (and everywhere else); OpenCV's bundled FFmpeg has no H.264
  encoder, and its only MP4 option (`mp4v`) is a codec browsers cannot decode
- **AsyncEventBus** (in `events/`) implements `EventPublisher` (write side) and
  `EventStream` (read side) — the in-process bus backing the SSE transport
- **MediaStore** (in `storage/`) implements `BlobStore` — sanitizes an upload's
  name, makes it unique and writes it under `<media root>/uploads`, which is the
  directory the container owns, so the reported path is readable as-is
- **VolumeArtifacts** (in `storage/`) implements `ArtifactReader` *and*
  `ArtifactRemover` — resolves a requested path against the resolved media and
  output roots (and checks containment on the resolved path), so the API can only
  ever hand back or delete files it could have produced itself
- **EventProgressReporter** (in `events/`) implements `ProgressReporter` — pushes
  frames from the render thread onto the event loop (`call_soon_threadsafe`),
  never raising into the render that is reporting
- **`sse/`**: `ORPCSseStream` — framework-agnostic encoder for the
  oRPC-compatible wire format (comments/keep-alives, `id`/`data` message
  frames, `close`/`error` frames); see `docs/orpc-sse-wire-format.md`
- **`config/`**: `ApiSettings`, loaded from `APP_*` environment variables
  (host, port, log level, CORS origins, media and output roots)
- **`tauri/backend_client.py`**: helpers that let a Tauri shell start/stop the
  Dockerized backend and probe its health endpoint (see
  `docs/tauri-integration.md`)

### 4. Presentation Layer (`src/ai_img2sketch/presentation/`)

- **cli.py**: the Click/Rich command-line interface (`generate`, `info`)
- **bundled.py**: resolves the hand image/mask bundled inside the package;
  shared by the CLI and the API
- **composition.py**: the **composition root** — the single place that
  constructs concrete adapters and injects them into the use cases
- **api/**: a second interface adapter — the FastAPI web layer:
  - `app.py` — `create_app()` factory (CORS from `ApiSettings`, lifespan that
    pushes a terminal `close` event on shutdown) plus a module-level `app` for
    `uvicorn ai_img2sketch.presentation.api.app:app`
  - `routers/` — `create_health_router()`, `create_media_router()`,
    `create_artifacts_router()`, `create_sketches_router()` and
    `create_events_router()`, each built by a factory injecting dependencies,
    mounted under `/api/v1`
  - `schemas.py` — request/response DTOs translated into domain value objects;
    every CLI option is settable per request (plus `black_pixel_threshold` and
    custom hand assets), making the API a superset of the CLI
  - SSE frames follow the oRPC-compatible lifecycle *initial flush comment →
    `id`/`data` message frames carrying the `"event"` discriminant → anonymous
    keep-alive comments (bus keep-alive) → terminal `close` frame*; the wire format
    is documented in `docs/orpc-sse-wire-format.md`
  - `__main__.py` — the `img2sketch-api` console script runner

## Design Patterns

### Ports & Adapters
The application defines ports; infrastructure provides adapters. Swapping a
technology (e.g. a different image library) means writing a new adapter, not
touching use cases.

### Dependency Injection
`GenerateSketchVideoUseCase` receives every boundary as a constructor argument.
`composition.py` wires the real ones; tests pass fakes.

### Value Object
`Dimensions`, `VideoConfig` and `Video` are immutable and self-validating.

## SOLID Principles

### Single Responsibility
Each class has one reason to change: `HandOverlayService` only overlays the
hand, `DrawingPathCalculator` only computes drawing order, adapters only talk
to OpenCV.

### Open/Closed
New behaviour is added by supplying a new port implementation (e.g. a new
`ImagePreprocessor`) rather than editing the use case.

### Liskov Substitution
Any object satisfying a port's structurally-checked interface can replace
another (the real adapters and the test fakes are interchangeable).

### Interface Segregation
Ports are intentionally tiny (`VideoWriter` has just `write_frame` and
`release`; `SketchVideoGenerator` has just `execute`).

### Dependency Inversion
High-level policy (use case, services) depends on the ports it owns; low-level
detail (OpenCV) depends on those ports. The dependency arrow is inverted.

## Data Flow

```
CLI (composition root)
    ↓ builds adapters + use case
GenerateSketchVideoUseCase  (single image)
    ↓ uses ports (HandLoader, ImagePreprocessor, ObjectMaskLoader, VideoWriter)
    ↓ uses services (DimensionAdjuster, GridCalculator, DrawingPathCalculator, DrawingPlanner, DrawingSpeedCalculator, HandOverlayService)
Domain entities + value objects
    ↓ (adapters translate to/from OpenCV + disk)
Video output

GenerateVideosFromDirectoryUseCase  (folder)
    ↓ uses ImageDirectoryScanner + ImageLoader
    ↓ delegates each image to the single generator via the SketchVideoGenerator port

FastAPI (HTTP interface adapters)
    POST /api/v1/media          → decodes the client's upload → BlobStore → backend-readable path
    POST /api/v1/sketches      → parses DTO → VideoConfig → use case (in a worker thread)
                                 → publishes sketch.* events + sketch.progress frames
    POST /api/v1/sketches/batch → BatchSummary → BatchSketchResult
                                 → publishes batch.* events + batch.progress frames
    GET  /api/v1/artifacts/download → ArtifactReader → the produced file's bytes
    DELETE /api/v1/artifacts    → ArtifactRemover → the file is gone (204)
    GET  /api/v1/events        → EventStream.subscribe() → SSE frames
    (parallel transport, same use cases — no business logic in the HTTP layer)
```

Nothing persists by default: the compose stack mounts both directories as
`tmpfs`, so a restart wipes them, and a client that wants a file gone sooner
calls `DELETE /api/v1/artifacts`. Downloads are the only way a produced file
reaches the host, which is why the reader and the remover share one containment
rule.

## Type Safety

- **Pydantic**: runtime validation of domain models
- **Type hints**: full coverage, Python 3.13
- **ty**: static type checking (`task typecheck`)
- **numpy.typing**: typed arrays for pixel data
- No `# type: ignore`; the OpenCV boundary uses explicit `typing.cast`

## Testing Strategy

Tests live in `tests/` and run with `uv run pytest` (or `task test`):

1. **Domain / value-object tests** — validation, immutability, helpers
2. **Service tests** — dimension rounding, grid splitting, drawing order, overlay
3. **Use-case tests** — drive `GenerateSketchVideoUseCase` entirely with
   in-memory fakes implementing the ports (no OpenCV, no filesystem)
4. **Infrastructure tests** — event bus pub/sub, keep-alives, port conformance
5. **CLI tests** — invoke commands with Click's `CliRunner` against a real image
6. **Web API tests** — FastAPI `TestClient` for REST/CORS; the SSE lifecycle is
   exercised against a real uvicorn server with `httpx.AsyncClient` streaming
   (TestClient's ASGI transport cannot stream)

## Benefits

1. **Maintainability**: clear layer boundaries; OpenCV is isolated to adapters
2. **Testability**: use cases run without OpenCV thanks to injected ports
3. **Flexibility**: implementations are swappable behind the ports
4. **Type safety**: `ty` + Pydantic catch errors early
5. **Clarity**: business rules (grid, ordering, dimensions) are explicit services

## Future Enhancements

Ideas that fit the current architecture:

1. **Multiple hand styles**: an alternate `HandOverlayService` implementation
2. **Extra output formats**: a second `VideoWriter` adapter
3. **Recursive batch scanning**: a `recursive` option on the scanner adapter
