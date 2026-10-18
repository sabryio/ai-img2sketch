# AI Image to Sketch Video

Convert images to animated sketch videos with a realistic drawing hand effect. This tool creates captivating whiteboard-style animations from static images.

## Features

- 🎨 Converts static images to animated sketch videos
- ✋ Realistic drawing hand animation
- 🎯 Customizable drawing speed and parameters
- 🧩 Object masking to control the drawing order of regions
- 📁 Batch mode to turn a whole folder of images into videos
- 📐 Automatic resolution optimization
- 💻 Modern CLI with rich output using Click and Rich
- 🏗️ Clean Architecture with SOLID principles
- ✅ Type-safe with Pydantic models and type hints
- 🔍 Type checking with `ty`

## Installation

You can install `img2sketch` so it's available from any folder on your system,
or just run it locally with `uv run`.

### Prerequisites

- Python 3.10 or higher
- [uv](https://docs.astral.sh/uv/getting-started/installation/) package manager

### Install uv

```bash
# On macOS and Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# On Windows
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# Or using pip
pip install uv
```

### Install as a global tool (recommended)

This lets you run `img2sketch` from any directory:

```bash
# Clone the repository
git clone <repository-url>
cd ai-img2sketch

# Install the CLI globally with uv
uv tool install .
```

To verify the installation:

```bash
img2sketch --version
```

To upgrade later after pulling changes:

```bash
uv tool install . --force
```

To uninstall:

```bash
uv tool uninstall ai-img2sketch
```

### Run without installing (local only)

If you don't want a global install, run it via `uv` from the project folder:

```bash
# Clone the repository
git clone <repository-url>
cd ai-img2sketch

# Create virtual environment and install dependencies
uv sync

# Run the CLI using uv
uv run img2sketch --help
```

## Quick Start with Task

This project uses [Task](https://taskfile.dev) for common operations:

```bash
# Install dependencies
task install

# Show image information
task info

# Generate sketch video
task generate

# Run all code quality checks
task check

# Auto-fix code issues
task fix
```

See all available tasks: `task --list`

## Usage

### Basic Usage

```bash
# Generate a sketch video -> input.mp4 (written next to the image)
img2sketch generate input.jpg

# Or with uv (no global install)
uv run img2sketch generate input.jpg

# Or using the main script
uv run python main.py generate input.jpg

# Generate from current directory
img2sketch generate .

# Send the video to a different directory instead
img2sketch generate input.jpg --output ./my_videos

# With custom parameters
img2sketch generate input.jpg \
    --split-len 15 \
    --frame-rate 30 \
    --object-skip-rate 10

# Generate a video for every image in a folder
img2sketch generate ./my_images
```

### Folder (Batch) Mode

Pass a folder instead of an image file and one video is generated for every
image found directly inside it. Just like a single image, each video is written
next to its source and named after it (`photo.jpg` → `photo.mp4`):

```bash
# Every image in ./my_images -> ./my_images/<name>.mp4
img2sketch generate ./my_images

# Generate from current directory
img2sketch generate .

# Or send every video to a single folder instead
img2sketch generate ./my_images --output ./videos
```

Batch mode:

- Scans the **top level only** (subfolders are ignored).
- Recognises `.png`, `.jpg`, `.jpeg`, `.bmp`, `.webp`, `.tif`, `.tiff`.
- **Overwrites** an existing `<name>.mp4`.
- Keeps going if one image fails, prints a summary, and exits non-zero if any
  image failed.
- If `--object-masks` is given, the same mask document is applied to every
  image (masks are scaled to each image's size).

### Get Image Information

```bash
# Analyze image and get recommendations
img2sketch info input.jpg

# Check compatibility with specific split length
img2sketch info input.jpg --split-len 20
```

### CLI Options

```bash
img2sketch generate [OPTIONS] SOURCE

Arguments:
  SOURCE                        An image file, or a folder of images

Options:
  -o, --output PATH              Output directory (default: next to each image)
  --split-len INTEGER           Grid split length [5-100] (default: 10)
  --frame-rate INTEGER          Video frame rate [1-120] (default: 25)
  --object-skip-rate INTEGER    Object drawing skip rate [1-100] (default: 8)
  --draw-duration FLOAT         Target seconds for the drawing phase, floored
  --end-duration INTEGER        Final image duration [0-10] seconds (default: 2)
  --hand-image PATH             Custom hand image path
  --hand-mask PATH              Custom hand mask path
  --object-masks PATH           JSON file describing ordered object masks
  --help                        Show this message and exit
```

### Parameters Explained

- **split-len**: Divides the image into grids. Higher values = larger grids = faster drawing
- **frame-rate**: Standard video frame rate (25-30 recommended)
- **object-skip-rate**: Lower values = more detailed/slower drawing
- **draw-duration**: Target seconds for the drawing phase, floored (see below); overrides `--object-skip-rate`
- **end-duration**: Duration (in seconds) to display the final colored image
- **object-masks**: JSON file (see below) that draws regions in a specified order

### Drawing Duration

Want the drawing to take a specific amount of time (say 3, 5 or 10 seconds)?
Use `--draw-duration` and the tool picks the drawing speed for you:

```bash
# Draw the image over roughly 5 seconds, then hold the result for 2 seconds
img2sketch generate input.jpg --draw-duration 5

# Draw in ~10 seconds
img2sketch generate input.jpg --draw-duration 10

# Only the drawing phase (no final hold)
img2sketch generate input.jpg --draw-duration 4 --end-duration 0
```

The achievable duration is quantised. A drawing frame is written every
`skip-rate` grid cells, so the drawing lasts `floor(cells / skip-rate) / frame-rate`
seconds, where `cells` is the "Found N grid cells to draw" count the tool logs.
`--draw-duration` **floors** the drawing to your target: it picks the longest
duration that does not exceed the target (so the drawing never runs past it) and
logs the value it settled on. If the floored result is far from the target it
prints a warning — add detail with a smaller `--split-len` (more cells = finer
control) or tweak `--frame-rate`.

`--draw-duration` sets the default drawing speed; a per-object `skip_rate` in an
object-mask document still takes precedence for that object (the tool warns when
that may shift the total).

### Drawing Hand

The drawing hand image and its mask are **bundled inside the package**, so they
resolve correctly no matter where `img2sketch` is installed or which folder you
run it from. You normally never need to pass them. To use a custom hand, point
the CLI at your own files:

```bash
img2sketch generate input.jpg \
    --hand-image path/to/hand.png \
    --hand-mask path/to/hand-mask.png
```

### Object Masking

By default the whole image is drawn as one region, in a nearest-neighbour path.
With `--object-masks` you can split it into named objects and control the order
in which they are drawn, plus a per-object drawing speed:

```bash
img2sketch generate input.jpg --object-masks objects.json
```

The mask file is JSON. Objects are drawn in the order they appear:

```json
{
  "objects": [
    {"name": "face", "mask": "face.png", "skip_rate": 4},
    {"name": "sign", "rect": [512, 60, 400, 180]},
    {"name": "background", "skip_rate": 16}
  ]
}
```

Each entry supports:

- **name** (required): a label used in logs.
- **mask** (optional): path to a mask image, resolved relative to the JSON file.
  Non-zero pixels belong to the object. The mask is authored at the source image
  size and scaled automatically.
- **rect** (optional): `[x, y, width, height]` in source-image pixels.
- **skip_rate** (optional): draw speed for this object. Falls back to
  `--object-skip-rate` when omitted.

An entry may define **either** `mask` or `rect`, but not both. An entry with
neither becomes the catch-all "background" object and owns every pixel not
claimed by another mask.

A ready-to-use example lives at `images/example-object-masks.json`:

```bash
task generate:objects
```

## Web API (FastAPI)

The same use cases are exposed over HTTP with a Server-Sent-Events stream:

```bash
# With Docker (binds localhost:8000, health check included)
docker compose up -d

# Or locally without Docker
uv run img2sketch-api
```

```bash
# Health probe
curl http://localhost:8000/api/v1/health

# Generate one sketch video
curl -X POST http://localhost:8000/api/v1/sketches \
  -H "Content-Type: application/json" \
  -d '{"image_path": "/app/media/photo.jpg", "output_dir": "/app/output"}'

# Stream lifecycle events (initial ack -> id'd event frames -> close)
curl -N http://localhost:8000/api/v1/events
```

- `docs/api.md` — complete API reference for humans and agents: schemas,
  ranges, SSE protocol, error mapping, concurrency notes.
- `docs/tauri-integration.md` — start/locate/communicate guide for the Tauri
  shell (sidecar vs Docker, lifecycle, volumes, env vars).
- `docs/frontend-ai-prompt.md` — a ready-to-paste prompt for an AI coding
  agent to generate the Tauri frontend against the API.

## Project Structure

This project follows **Clean Architecture** principles with clear separation of concerns:

```
ai-img2sketch/
├── src/ai_img2sketch/
│   ├── domain/                    # Domain layer (pure business model)
│   │   ├── entities/              # Core business entities
│   │   │   ├── image.py          # Image entity
│   │   │   ├── hand.py           # Hand entity
│   │   │   └── video.py          # Video entity
│   │   └── value_objects/        # Immutable value objects
│   │       ├── dimensions.py     # Dimensions value object
│   │       ├── object_mask.py    # Object mask value object
│   │       └── video_config.py   # Video configuration
│   ├── application/               # Application layer
│   │   ├── ports/                # Interfaces the app depends on
│   │   │   ├── blob_store.py
│   │   │   ├── image_loader.py
│   │   │   ├── hand_loader.py
│   │   │   ├── image_preprocessor.py
│   │   │   ├── image_scanner.py
│   │   │   ├── object_mask_loader.py
│   │   │   ├── sketch_video_generator.py
│   │   │   └── video_writer.py
│   │   ├── services/             # Pure, stateless business logic
│   │   │   ├── dimension_adjuster.py
│   │   │   ├── drawing_calculator.py
│   │   │   ├── drawing_planner.py
│   │   │   ├── hand_overlay.py
│   │   │   └── video_path_resolver.py
│   │   └── use_cases/
│   │       ├── generate_sketch_video.py   # Single image
│   │       └── generate_batch_videos.py   # Whole folder
│   ├── infrastructure/            # Adapters implementing the ports
│   │   ├── image_processing/
│   │   │   ├── image_loader.py   # OpenCVImageLoader
│   │   │   ├── hand_loader.py    # OpenCVHandLoader
│   │   │   ├── image_scanner.py  # FileSystemImageScanner
│   │   │   ├── object_mask_loader.py  # JsonObjectMaskLoader
│   │   │   └── preprocessor.py   # OpenCVImagePreprocessor
│   │   └── video/
│   │       └── video_writer.py           # OpenCVVideoWriter
│   │   ├── events/
│   │   │   └── async_event_bus.py        # In-process pub/sub backing SSE
│   │   ├── storage/
│   │   │   └── media_store.py    # MediaStore: stages client uploads in the volume
│   │   ├── config/
│   │   │   └── settings.py        # ApiSettings (APP_* environment variables)
│   │   └── tauri/
│   │       └── backend_client.py         # Docker start/stop/health helpers
│   ├── presentation/              # Presentation layer (CLI + HTTP API)
│   │   ├── cli.py                # Click CLI interface
│   │   ├── bundled.py            # Bundled hand assets resolver
│   │   ├── composition.py        # Composition root (wires everything)
│   │   └── api/                  # FastAPI interface adapter (REST + SSE)
│   │       ├── app.py            # create_app() factory + module-level app
│   │       ├── settings.py       # ApiSettings re-export
│   │       ├── schemas.py        # Request/response DTOs
│   │       ├── __main__.py       # img2sketch-api console entry point
│   │       └── routers/          # health.py, media.py, sketches.py, events.py (SSE)
│   └── resources/                 # Bundled package data
│       └── images/                # Default hand image + mask (shipped in the wheel)
│           ├── drawing-hand.png
│           └── hand-mask.png
├── tests/                        # pytest suite (unit + CLI)
├── main.py                       # Entry point
├── pyproject.toml               # Project configuration
├── uv.lock                      # Locked dependencies
└── images/                      # Example/test assets and mask examples
    ├── cartoon.png
    ├── drawing-hand.json
    ├── example-object-masks.json
    └── ...
```

The drawing-hand image and mask used at runtime are shipped inside the package
(`src/ai_img2sketch/resources/images/`) so they resolve from any working
directory. The root `images/` folder holds example and test assets only.

### Architecture Layers

1. **Domain Layer**: Pure business logic with no external dependencies
2. **Application Layer**: Use cases orchestrating domain entities
3. **Infrastructure Layer**: Concrete implementations of services
4. **Presentation Layer**: CLI and FastAPI HTTP/SSE interfaces for user interaction

## Development

### Code Quality

```bash
# Type checking with ty (checks src/ and tests/)
uv run ty check

# Linting with ruff
uv run ruff check src/ tests/

# Format code
uv run ruff format src/ tests/

# Run the test suite
uv run pytest

# Fix auto-fixable issues
uv run ruff check --fix src/ tests/
```

### Adding Dependencies

```bash
# Using Task
task deps:add -- package-name

# Using uv directly
uv add package-name

# Add a development dependency
uv add --dev package-name

# Add a specific version
uv add package-name==1.0.0
```

### Updating Dependencies

```bash
# Using Task
task deps:update

# Using uv directly
uv sync --upgrade

# Update a specific package
uv add package-name --upgrade
```

### Remove Dependencies

```bash
# Using Task
task deps:remove -- package-name

# Using uv directly
uv remove package-name
```

### Project Principles

This project follows **SOLID principles**:

- **Single Responsibility**: Each class has one reason to change
- **Open/Closed**: Open for extension, closed for modification
- **Liskov Substitution**: Interfaces can be substituted with implementations
- **Interface Segregation**: Small, focused interfaces (protocols)
- **Dependency Inversion**: Depend on abstractions, not concretions

## Key Dependencies

- **click**: Command-line interface framework
- **rich**: Beautiful terminal output
- **pydantic**: Data validation using Python type hints
- **opencv-python**: Image processing and video generation
- **numpy**: Numerical computations
- **ty**: Type checker for Python

## How It Works

1. **Image Preprocessing**: Converts image to grayscale and applies adaptive thresholding
2. **Grid Division**: Divides the image into manageable grid sections
3. **Path Finding**: Uses Euclidean distance to find the optimal drawing path
4. **Animation Generation**: Draws each section while overlaying the hand animation
5. **Video Output**: Compiles frames into an MP4 video

## Testing

The test suite uses [pytest](https://docs.pytest.org/) and runs without touching
OpenCV or the filesystem for the use case, thanks to the ports-and-adapters design:

```bash
uv run pytest        # or: task test
task check           # lint + format + typecheck + tests
```

## License

See [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## Troubleshooting

### Video Not Generating

- Dimensions are automatically rounded to a multiple of the split length
- Videos are written next to their source image as `<name>.mp4` (or into
  `--output` when given); make sure that folder is writable
- Verify all dependencies are installed correctly

### Performance Issues

- Increase skip rates for faster processing
- Reduce image resolution
- Use larger split length values
