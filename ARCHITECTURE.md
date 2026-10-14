# Architecture Documentation

## Overview

This project follows a **Clean Architecture** (Ports & Adapters / Hexagonal)
style. Dependencies point **inward**: the domain knows nothing about the
application, and the application knows nothing about infrastructure or the CLI.
The outer layers (infrastructure, presentation) depend on abstractions that the
application defines.

```
        ┌───────────────────────────────────────────┐
        │ Presentation (Click CLI + composition)     │
        │   └── depends on ──┐                        │
        └────────────────────┼───────────────────────┘
                             ▼
        ┌───────────────────────────────────────────┐
        │ Application (use cases, ports, services)   │
        │   └── depends on ──┐                        │
        └────────────────────┼───────────────────────┘
                             ▼
        ┌───────────────────────────────────────────┐
        │ Domain (entities, value objects)           │
        └───────────────────────────────────────────┘

        Infrastructure (OpenCV adapters) ── implements ──▶ Application ports
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
- **VideoWriter** / **VideoWriterFactory**: write frames
- **OutputPathGenerator**: choose an output path

These are `typing.Protocol` definitions. The application never imports
infrastructure; infrastructure imports the ports.

#### Services (`application/services/`) — pure business logic
- **DimensionAdjuster**: rounds dimensions to a multiple of `split_len`
- **GridCalculator**: splits an image into a grid
- **DrawingPathCalculator**: nearest-neighbour drawing order
- **HandOverlayService**: composites the hand onto a frame

These are stateless and side-effect free, so they are used directly (not
injected) and are trivially unit-testable.

#### Use Cases (`application/use_cases/`)
- **GenerateSketchVideoUseCase**: loads the hand, preprocesses the image,
  draws cell by cell, writes frames and returns the output path. All I/O
  boundaries arrive via constructor injection.

### 3. Infrastructure Layer (`src/ai_img2sketch/infrastructure/`)

Adapters that implement the application ports. Everything that touches OpenCV
or the filesystem lives here.

- **OpenCVImageLoader** implements `ImageLoader`
- **OpenCVHandLoader** implements `HandLoader`
- **OpenCVImagePreprocessor** implements `ImagePreprocessor`
- **OpenCVVideoWriter** implements `VideoWriter`; `create_opencv_video_writer`
  implements `VideoWriterFactory`
- **TimestampedOutputPathGenerator** implements `OutputPathGenerator`

### 4. Presentation Layer (`src/ai_img2sketch/presentation/`)

- **cli.py**: the Click/Rich command-line interface (`generate`, `info`)
- **composition.py**: the **composition root** — the single place that
  constructs concrete adapters and injects them into the use case

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
`release`; `OutputPathGenerator` has just `generate`).

### Dependency Inversion
High-level policy (use case, services) depends on the ports it owns; low-level
detail (OpenCV) depends on those ports. The dependency arrow is inverted.

## Data Flow

```
CLI (composition root)
    ↓ builds adapters + use case
GenerateSketchVideoUseCase
    ↓ uses ports (ImageLoader, HandLoader, ImagePreprocessor, VideoWriter, OutputPathGenerator)
    ↓ uses services (DimensionAdjuster, GridCalculator, DrawingPathCalculator, HandOverlayService)
Domain entities + value objects
    ↓ (adapters translate to/from OpenCV + disk)
Video output
```

## Type Safety

- **Pydantic**: runtime validation of domain models
- **Type hints**: full coverage, Python 3.10+ syntax
- **ty**: static type checking (`task typecheck`)
- **numpy.typing**: typed arrays for pixel data
- No `# type: ignore`; the OpenCV boundary uses explicit `typing.cast`

## Testing Strategy

Tests live in `tests/` and run with `uv run pytest` (or `task test`):

1. **Domain / value-object tests** — validation, immutability, helpers
2. **Service tests** — dimension rounding, grid splitting, drawing order, overlay
3. **Use-case tests** — drive `GenerateSketchVideoUseCase` entirely with
   in-memory fakes implementing the ports (no OpenCV, no filesystem)
4. **CLI tests** — invoke commands with Click's `CliRunner` against a real image

## Benefits

1. **Maintainability**: clear layer boundaries; OpenCV is isolated to adapters
2. **Testability**: use cases run without OpenCV thanks to injected ports
3. **Flexibility**: implementations are swappable behind the ports
4. **Type safety**: `ty` + Pydantic catch errors early
5. **Clarity**: business rules (grid, ordering, dimensions) are explicit services

## Future Enhancements

Ideas that fit the current architecture:

1. **Object masking**: reintroduce as an optional port + mask-aware drawing order
2. **Multiple hand styles**: an alternate `HandOverlayService` implementation
3. **Extra output formats**: a second `VideoWriter` adapter
4. **Batch processing**: a new use case composing the existing one
5. **Web API**: a FastAPI presentation layer reusing the same use case
6. **Progress reporting**: a `ProgressReporter` port injected into the use case
