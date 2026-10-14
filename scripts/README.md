# Video Processing Scripts

This folder contains automation scripts for batch processing images with voice-overs.

**✨ Key Feature: Run from anywhere!** All paths are automatically resolved to absolute paths, so you can run this script from any directory on your computer and reference files from any location.

## Files

- **process-videos.ts** - Main Bun script that reads JSON config and generates videos
- **config.example.json** - Example configuration file
- **batch-process.bat** - Windows launcher (run from anywhere)
- **batch-process.sh** - Linux/Mac launcher (run from anywhere)
- **README.md** - This documentation

## Requirements

- [Bun](https://bun.sh/) runtime installed
- `img2sketch` CLI installed (see main README)
- `ffprobe` (from FFmpeg) for audio duration detection

### Install FFmpeg

```bash
# Windows (using winget)
winget install FFmpeg

# Or using Chocolatey
choco install ffmpeg

# macOS
brew install ffmpeg

# Linux (Ubuntu/Debian)
sudo apt install ffmpeg
```

## Usage

### Quick Start

1. Copy the example config:

   ```bash
   cp scripts/config.example.json config.json
   ```

2. Edit `config.json` with your image-voice pairs:

   ```json
   [
     { "image": "./images/image1.jpg", "voice": "./voices/voice1.mp3" },
     { "image": "./images/image2.jpg", "voice": "./voices/voice2.mp3" }
   ]
   ```

3. Run the script:

   ```bash
   # From project directory
   bun run process

   # From anywhere using the launcher (Windows)
   D:\path\to\scripts\batch-process.bat -i D:\my-project\config.json -o D:\output

   # From anywhere using the launcher (Linux/Mac)
   /path/to/scripts/batch-process.sh -i ~/my-project/config.json -o ~/output
   ```

### Running from Anywhere

The script can be executed from any directory. Choose your preferred method:

#### Method 1: Direct execution with bun

```bash
# Windows
bun D:\programming\Python\ai-img2sketch\scripts\process-videos.ts -i D:\my-videos\config.json -o D:\output

# Linux/Mac
bun ~/programming/ai-img2sketch/scripts/process-videos.ts -i ~/my-videos/config.json -o ~/output
```

#### Method 2: Using the launcher scripts

```bash
# Windows (double-click or command line)
D:\programming\Python\ai-img2sketch\scripts\batch-process.bat -i config.json -o output

# Linux/Mac (make executable first)
chmod +x ~/programming/ai-img2sketch/scripts/batch-process.sh
~/programming/ai-img2sketch/scripts/batch-process.sh -i config.json -o output
```

#### Method 3: Add to PATH (for ultimate convenience)

**Windows:**

1. Add `D:\programming\Python\ai-img2sketch\scripts` to your PATH
2. Then run from anywhere:
   ```cmd
   batch-process -i D:\my-videos\config.json -o D:\output
   ```

**Linux/Mac:**

1. Create a symlink:
   ```bash
   sudo ln -s ~/programming/ai-img2sketch/scripts/batch-process.sh /usr/local/bin/batch-process
   ```
2. Then run from anywhere:
   ```bash
   batch-process -i ~/my-videos/config.json -o ~/output
   ```

### Command Line Options

```bash
# Use default config.json and output to ./videos
bun scripts/process-videos.ts

# Specify custom config file
bun scripts/process-videos.ts --input my-config.json

# Specify custom output directory
bun scripts/process-videos.ts --output ./my-videos

# Both custom input and output
bun scripts/process-videos.ts -i my-config.json -o ./output

# Show help
bun scripts/process-videos.ts --help
```

## Path Resolution

The script intelligently handles both relative and absolute paths:

### Command-line Paths (`--input`, `--output`)

- Resolved relative to your **current working directory**
- You can use absolute paths for complete control

### Config File Paths (`image`, `voice` in JSON)

- Resolved relative to the **config file's directory**
- This allows you to keep the config with your media files
- You can also use absolute paths if needed

### Examples

**Example 1: All files in one project folder**

```
D:/my-project/
├── config.json           # {"image": "./images/pic.jpg", "voice": "./audio/voice.mp3"}
├── images/
│   └── pic.jpg
└── audio/
    └── voice.mp3
```

```bash
cd D:/my-project
bun /path/to/scripts/process-videos.ts -i config.json -o ./output
```

**Example 2: Config in different location from media**

```
D:/configs/config.json    # {"image": "D:/media/pic.jpg", "voice": "D:/audio/voice.mp3"}
D:/media/pic.jpg
D:/audio/voice.mp3
```

```bash
# Run from anywhere
bun /path/to/scripts/process-videos.ts -i D:/configs/config.json -o D:/output
```

**Example 3: Mixed relative/absolute (relative to config file)**

```
D:/project/
├── config/
│   └── videos.json       # {"image": "../images/pic.jpg", "voice": "../audio/voice.mp3"}
├── images/
│   └── pic.jpg
└── audio/
    └── voice.mp3
```

```bash
bun /path/to/scripts/process-videos.ts -i D:/project/config/videos.json -o D:/output
```

## How It Works

1. **Reads JSON config** - Loads image-voice pairs from JSON file
2. **Detects voice duration** - Uses `ffprobe` to get accurate audio duration
3. **Generates videos** - Calls `img2sketch generate` for each pair:
   - `--draw-duration` is set to match the voice duration
   - `--end-duration 2` for all images EXCEPT the last one
   - `--end-duration 0` for the last image (no final hold)
4. **Outputs videos** - All videos are saved to the specified output directory

## Config File Format

```json
[
  {
    "image": "path/to/image.jpg",
    "voice": "path/to/voice.mp3"
  }
]
```

### Rules

- Must be a JSON array
- Each object must have `image` and `voice` properties
- Paths can be:
  - **Relative** to the config file directory (recommended for portability)
  - **Absolute** paths (works from any directory)
- Supported image formats: jpg, jpeg, png, bmp, webp, tif, tiff
- Supported audio formats: any format that `ffprobe` can read (mp3, wav, m4a, etc.)

### Path Examples in Config

```json
[
  // Relative to config file (recommended)
  { "image": "./images/pic1.jpg", "voice": "./audio/voice1.mp3" },

  // Relative with parent directory
  { "image": "../shared-images/pic2.jpg", "voice": "../audio/voice2.mp3" },

  // Absolute paths (Windows)
  { "image": "D:/media/pic3.jpg", "voice": "D:/audio/voice3.mp3" },

  // Absolute paths (Linux/Mac)
  {
    "image": "/home/user/media/pic4.jpg",
    "voice": "/home/user/audio/voice4.mp3"
  }
]
```

## Example Workflow

```bash
# 1. Create your config anywhere
cat > D:/my-videos/config.json << 'EOF'
[
  { "image": "./images/cartoon.png", "voice": "./voices/intro.mp3" },
  { "image": "./images/stage.png", "voice": "./voices/middle.mp3" },
  { "image": "./images/final.png", "voice": "./voices/outro.mp3" }
]
EOF

# 2. Process all videos from any directory
cd /tmp  # or any directory
batch-process -i D:/my-videos/config.json -o D:/my-videos/output

# 3. Find your videos
ls D:/my-videos/output/
```

## Output

- Videos are named after their source images (e.g., `cartoon.png` → `cartoon.mp4`)
- All videos are placed in the output directory (default: `./videos`)
- Console shows progress for each video
- Final summary shows success/failure count

## Troubleshooting

### "ffprobe not found"

Install FFmpeg (see requirements above) and ensure it's in your PATH.

### "img2sketch not found"

Make sure you've installed the `img2sketch` CLI:

```bash
# Global install
uv tool install .

# Or use with uv run
# Edit the script to use: uv run img2sketch
```

### Invalid duration

Check that your audio files are valid and not corrupted. Test with:

```bash
ffprobe path/to/voice.mp3
```

### File not found errors

- Check that paths in your config are correct
- Remember: relative paths in the JSON are resolved relative to the config file location
- Use absolute paths if you're unsure
- Run with `--help` to see path resolution details
