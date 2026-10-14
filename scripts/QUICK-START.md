# Quick Start Guide

## 🚀 5-Minute Setup

### 1. Install Requirements
```bash
# Install Bun (if not already installed)
# Windows
powershell -c "irm bun.sh/install.ps1|iex"

# Linux/Mac
curl -fsSL https://bun.sh/install | bash

# Install FFmpeg (if not already installed)
# Windows
winget install FFmpeg

# Mac
brew install ffmpeg

# Linux
sudo apt install ffmpeg
```

### 2. Create Your Config
```json
[
  { "image": "D:/images/pic1.jpg", "voice": "D:/audio/voice1.mp3" },
  { "image": "D:/images/pic2.jpg", "voice": "D:/audio/voice2.mp3" }
]
```
Save as `my-config.json` anywhere on your computer.

### 3. Run!
```bash
# Windows
D:\programming\Python\ai-img2sketch\scripts\batch-process.bat -i D:\path\to\my-config.json -o D:\output

# Linux/Mac
~/programming/ai-img2sketch/scripts/batch-process.sh -i ~/path/to/my-config.json -o ~/output
```

## 💡 Tips

**Use relative paths in your config:**
```json
[
  { "image": "./images/pic1.jpg", "voice": "./voices/voice1.mp3" }
]
```
Place the config next to your `images/` and `voices/` folders for portability!

**Last image has no end pause:**
The script automatically sets `--end-duration 0` for the last image in your list.

**Voice duration = drawing duration:**
The script detects how long each voice file is and sets the drawing time to match.

## 📁 Recommended Structure
```
my-project/
├── config.json          ← Your config file
├── images/              ← Your images
│   ├── pic1.jpg
│   └── pic2.jpg
├── voices/              ← Your audio files
│   ├── voice1.mp3
│   └── voice2.mp3
└── output/              ← Generated videos (created automatically)
    ├── pic1.mp4
    └── pic2.mp4
```

## 🎯 Common Commands

```bash
# Show help
batch-process --help

# Process with default locations (./config.json → ./videos)
batch-process

# Custom input and output
batch-process -i my-config.json -o ./my-videos

# Using absolute paths (run from anywhere!)
batch-process -i D:/projects/video1/config.json -o D:/output
```

## ❓ Having Issues?

Check:
1. ✅ FFmpeg installed? Run: `ffprobe -version`
2. ✅ img2sketch installed? Run: `img2sketch --version`
3. ✅ Paths correct? Use absolute paths to be sure
4. ✅ Audio files valid? Test: `ffprobe your-audio.mp3`

For more details, see [README.md](./README.md)
