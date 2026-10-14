# AI Image to Sketch Video

Convert images to animated sketch videos with a realistic drawing hand effect. This tool creates captivating whiteboard-style animations from static images.

## Features

- 🎨 Converts static images to animated sketch videos
- ✋ Realistic drawing hand animation
- 🎯 Customizable drawing speed and parameters
- 📐 Automatic resolution optimization
- 🖼️ Support for object masking (draw specific parts in sequence)
- 💻 Modern CLI with rich output using Click and Rich
- 🏗️ Clean Architecture with SOLID principles
- ✅ Type-safe with Pydantic models and type hints
- 🔍 Type checking with `ty`

## Installation

This project uses [uv](https://github.com/astral-sh/uv) for dependency management.

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

### Setup Project

```bash
# Clone the repository
git clone <repository-url>
cd ai-img2sketch

# Create virtual environment and install dependencies
uv sync

# Activate the virtual environment
# On Windows
.venv\Scripts\activate

# On macOS/Linux
source .venv/bin/activate
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
# Generate sketch video from an image (using uv)
uv run img2sketch generate input.jpg

# Or using the main script
uv run python main.py generate input.jpg

# With custom output directory
uv run img2sketch generate input.jpg --output ./my_videos

# With custom parameters
uv run img2sketch generate input.jpg \
    --split-len 15 \
    --frame-rate 30 \
    --object-skip-rate 10 \
    --bg-skip-rate 16
```

### Get Image Information

```bash
# Analyze image and get recommendations
uv run img2sketch info input.jpg

# Check compatibility with specific split length
uv run img2sketch info input.jpg --split-len 20
```

### CLI Options

```bash
img2sketch generate [OPTIONS] IMAGE

Options:
  -o, --output PATH              Output directory (default: ./save_videos)
  --split-len INTEGER           Grid split length [5-100] (default: 10)
  --frame-rate INTEGER          Video frame rate [1-120] (default: 25)
  --object-skip-rate INTEGER    Object drawing skip rate [1-100] (default: 8)
  --bg-skip-rate INTEGER        Background skip rate [1-100] (default: 14)
  --end-duration INTEGER        Final image duration [0-10] seconds (default: 2)
  --hand-image PATH             Custom hand image path
  --hand-mask PATH              Custom hand mask path
  --help                        Show this message and exit
```

### Parameters Explained

- **split-len**: Divides the image into grids. Higher values = larger grids = faster drawing
- **frame-rate**: Standard video frame rate (25-30 recommended)
- **object-skip-rate**: Lower values = more detailed/slower drawing
- **bg-skip-rate**: Can be higher for faster background completion
- **end-duration**: Duration (in seconds) to display the final colored image

## Project Structure

This project follows **Clean Architecture** principles with clear separation of concerns:

```
ai-img2sketch/
├── src/
│   ├── domain/                    # Domain layer (business entities)
│   │   ├── entities/              # Core business entities
│   │   │   ├── image.py          # Image entity
│   │   │   ├── hand.py           # Hand entity
│   │   │   └── video.py          # Video entity
│   │   └── value_objects/        # Immutable value objects
│   │       ├── dimensions.py     # Dimensions value object
│   │       └── video_config.py   # Video configuration
│   ├── application/               # Application layer (use cases)
│   │   └── use_cases/
│   │       └── generate_sketch_video.py  # Main use case
│   ├── infrastructure/            # Infrastructure layer (implementations)
│   │   ├── image_processing/     # Image processing services
│   │   │   ├── preprocessor.py
│   │   │   ├── hand_overlay.py
│   │   │   ├── drawing_calculator.py
│   │   │   └── dimension_adjuster.py
│   │   └── video/
│   │       └── video_writer.py   # Video writing service
│   └── presentation/              # Presentation layer (CLI)
│       └── cli.py                # Click CLI interface
├── main.py                       # Entry point
├── pyproject.toml               # Project configuration
├── uv.lock                      # Locked dependencies
├── images/                      # Hand images and masks
│   ├── drawing-hand.png
│   └── hand-mask.png
└── save_videos/                # Output directory
```

### Architecture Layers

1. **Domain Layer**: Pure business logic with no external dependencies
2. **Application Layer**: Use cases orchestrating domain entities
3. **Infrastructure Layer**: Concrete implementations of services
4. **Presentation Layer**: CLI interface for user interaction

## Development

### Code Quality

```bash
# Type checking with ty
uv run ty src/

# Linting with ruff
uv run ruff check src/

# Format code
uv run ruff format src/

# Fix auto-fixable issues
uv run ruff check --fix src/
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

## Object Masking (Advanced)

For more control, you can create JSON mask files to specify drawing order for different objects. Place mask files in the `images/` directory with the same name as your image.

## License

See [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## Troubleshooting

### Video Not Generating

- Ensure image resolution is compatible with split length
- Check that the `save_videos` directory exists
- Verify all dependencies are installed correctly

### Performance Issues

- Increase skip rates for faster processing
- Reduce image resolution
- Use larger split length values
