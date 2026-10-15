# How to Use the Standalone Executable

## 🎯 No Installation Required!

The `batch-process.exe` is a **standalone executable** - you don't need Bun, Node.js, or anything else installed (except FFmpeg and img2sketch).

## ✅ Prerequisites

You still need these installed:
1. **FFmpeg** - For detecting audio duration
   ```bash
   winget install FFmpeg
   ```
2. **img2sketch** - The Python CLI tool
   ```bash
   uv tool install .
   ```

## 🚀 Quick Start

### Step 1: Create Your Config File

Create a JSON file (e.g., `config.json`) anywhere on your computer:

```json
[
  {
    "image": "D:/my-images/slide1.jpg",
    "voice": "D:/my-audio/narration1.mp3"
  },
  {
    "image": "D:/my-images/slide2.jpg",
    "voice": "D:/my-audio/narration2.mp3"
  }
]
```

**💡 Tip:** Use relative paths if your config is near your files:
```json
[
  { "image": "./images/slide1.jpg", "voice": "./audio/narration1.mp3" }
]
```

### Step 2: Run the Executable

Open Command Prompt or PowerShell and run:

```cmd
D:\programming\Python\ai-img2sketch\scripts\batch-process.exe -i D:\path\to\config.json -o D:\output
```

**Or if you're in the same folder as the config:**
```cmd
batch-process.exe -i config.json -o output
```

### Step 3: Find Your Videos

Videos will be in the output folder, named after your images:
- `slide1.jpg` → `slide1.mp4`
- `slide2.jpg` → `slide2.mp4`

## 📋 Command Line Options

```cmd
# Show help
batch-process.exe --help

# Use default paths (./config.json → ./videos)
batch-process.exe

# Custom input and output
batch-process.exe -i my-config.json -o my-videos

# Full absolute paths (run from anywhere!)
batch-process.exe -i D:\projects\video\config.json -o D:\output\videos
```

## 📁 Example Setup

**Option 1: Everything together (recommended)**
```
D:\my-project\
├── config.json
├── images\
│   ├── slide1.jpg
│   └── slide2.jpg
├── audio\
│   ├── voice1.mp3
│   └── voice2.mp3
└── output\           ← Videos go here
```

**config.json:**
```json
[
  { "image": "./images/slide1.jpg", "voice": "./audio/voice1.mp3" },
  { "image": "./images/slide2.jpg", "voice": "./audio/voice2.mp3" }
]
```

**Run:**
```cmd
cd D:\my-project
D:\programming\Python\ai-img2sketch\scripts\batch-process.exe -i config.json -o output
```

**Option 2: Files in different locations**
```json
[
  { "image": "D:/images/pic1.jpg", "voice": "C:/audio/voice1.mp3" },
  { "image": "D:/images/pic2.jpg", "voice": "C:/audio/voice2.mp3" }
]
```

## 🎬 What Happens

All image-voice pairs are processed **in parallel**. For each pair:

1. ✅ Detects voice duration (e.g., 8.5 seconds)
2. ✅ Sizes the drawing to `voice duration - 2s` (minimum 1s) and lets the CLI's default 2s end hold fill the rest, so the whole video matches the voice (8.5s)
3. ✅ Never passes `--end-duration` (the CLI's 2s default always applies)
4. ✅ Saves as `{image-name}.mp4` in output folder

## 💡 Pro Tips

### Tip 1: Copy the EXE anywhere
```cmd
# Copy to your project folder
copy D:\programming\Python\ai-img2sketch\scripts\batch-process.exe D:\my-project\

# Now run from that folder
cd D:\my-project
batch-process.exe -i config.json -o output
```

### Tip 2: Add to System PATH
1. Right-click "This PC" → Properties → Advanced system settings
2. Environment Variables → System Variables → Path → Edit
3. Add: `D:\programming\Python\ai-img2sketch\scripts`
4. Now run from anywhere: `batch-process.exe -i config.json`

### Tip 3: Create a shortcut
1. Right-click `batch-process.exe` → Create shortcut
2. Right-click shortcut → Properties
3. Set "Start in" to your project folder
4. Add arguments: `-i config.json -o output`
5. Double-click to run!

### Tip 4: Test audio first
```cmd
# Check if FFmpeg can read your audio
ffprobe D:\audio\voice.mp3

# Should show duration and format info
```

## 🔍 Troubleshooting

### "img2sketch not found"
Install the Python CLI:
```cmd
cd D:\programming\Python\ai-img2sketch
uv tool install .
# Verify: img2sketch --version
```

### "ffprobe not found"
Install FFmpeg:
```cmd
winget install FFmpeg
# Verify: ffprobe -version
```

### "File not found"
- Use absolute paths: `D:\full\path\to\file.jpg`
- Or use paths relative to config file: `./images/file.jpg`
- Check spelling and file extensions

### Videos are cut off or too long
The script targets `drawing + 2s hold = voice duration` automatically (the drawing is floored, so it may finish marginally early). If something seems wrong:
- Check voice file duration: `ffprobe voice.mp3`
- Make sure audio isn't corrupted
- Check img2sketch is working: `img2sketch info image.jpg`

## 📦 Portable Usage

You can copy just the `.exe` file to any Windows computer and use it! No installation needed.

**What to bring:**
1. ✅ `batch-process.exe` (this file)
2. ✅ Your `config.json`
3. ✅ Your images and audio files
4. ⚠️ Still need: FFmpeg and img2sketch installed on that computer

## 🎯 Common Use Cases

### Use Case 1: Educational Videos
```json
[
  { "image": "./slides/intro.png", "voice": "./narration/intro.mp3" },
  { "image": "./slides/topic1.png", "voice": "./narration/topic1.mp3" },
  { "image": "./slides/topic2.png", "voice": "./narration/topic2.mp3" },
  { "image": "./slides/conclusion.png", "voice": "./narration/conclusion.mp3" }
]
```

### Use Case 2: Product Demo
```json
[
  { "image": "./screenshots/feature1.png", "voice": "./voice/feature1.mp3" },
  { "image": "./screenshots/feature2.png", "voice": "./voice/feature2.mp3" },
  { "image": "./screenshots/cta.png", "voice": "./voice/cta.mp3" }
]
```

### Use Case 3: Story Animation
```json
[
  { "image": "./scenes/scene1.jpg", "voice": "./story/chapter1.mp3" },
  { "image": "./scenes/scene2.jpg", "voice": "./story/chapter2.mp3" },
  { "image": "./scenes/scene3.jpg", "voice": "./story/chapter3.mp3" }
]
```

## 📊 Output Example

Running the executable:
```cmd
batch-process.exe -i config.json -o videos
```

Console output:
```
📄 Reading config from: D:\my-project\config.json
📁 Output directory: D:\my-project\videos

✓ Found 3 image-voice pair(s)

🎵 Detecting duration for: D:\my-project\audio\voice1.mp3
🎵 Detecting duration for: D:\my-project\audio\voice2.mp3
🎵 Detecting duration for: D:\my-project\audio\voice3.mp3

  Voice: 8.50s -> draw 6.50s + 2s hold
[1/3] Processing: D:\my-project\images\slide1.jpg
  Draw duration: 6.50s (+ 2s hold)
  ✓ Generated video for D:\my-project\images\slide1.jpg

  Voice: 12.30s -> draw 10.30s + 2s hold
[2/3] Processing: D:\my-project\images\slide2.jpg
  Draw duration: 10.30s (+ 2s hold)
  ✓ Generated video for D:\my-project\images\slide2.jpg

  Voice: 6.80s -> draw 4.80s + 2s hold
[3/3] Processing: D:\my-project\images\slide3.jpg
  Draw duration: 4.80s (+ 2s hold)
  ✓ Generated video for D:\my-project\images\slide3.jpg

============================================================
📊 SUMMARY
============================================================
✓ Successful: 3/3

📁 Videos saved to: D:\my-project\videos
```

## 🎉 You're Ready!

The standalone executable makes it super easy to create batch videos. Just prepare your config and run! No complex setup needed.

For more details, see [README.md](./README.md)
