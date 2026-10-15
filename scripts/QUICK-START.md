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
# Windows (standalone executable — no Bun needed)
D:\programming\Python\ai-img2sketch\scripts\batch-process.exe -i D:\path\to\my-config.json -o D:\output

# Linux/Mac (run the TypeScript with Bun)
bun ~/programming/ai-img2sketch/scripts/process-videos.ts -i ~/path/to/my-config.json -o ~/output
```

## 💡 Tips

**Use relative paths in your config:**
```json
[
  { "image": "./images/pic1.jpg", "voice": "./voices/voice1.mp3" }
]
```
Place the config next to your `images/` and `voices/` folders for portability!

**Video length matches the voice-over:**
The script sizes the drawing to `voice duration - 2s` (never less than 1s, so short voices still draw); the CLI's default 2s end hold fills the rest. (The CLI floors the drawing, so a video can finish marginally early.)

**No end-duration option:**
The script never passes `--end-duration`, so the CLI's default 2s hold always applies.

**Videos are generated in parallel:**
All image-voice pairs are processed at once, so large batches finish faster.

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
batch-process.exe --help

# Process with default locations (./config.json → ./videos)
batch-process.exe

# Custom input and output
batch-process.exe -i my-config.json -o ./my-videos

# Using absolute paths (run from anywhere!)
batch-process.exe -i D:/projects/video1/config.json -o D:/output
```

## ❓ Having Issues?

Check:
1. ✅ FFmpeg installed? Run: `ffprobe -version`
2. ✅ img2sketch installed? Run: `img2sketch --version`
3. ✅ Paths correct? Use absolute paths to be sure
4. ✅ Audio files valid? Test: `ffprobe your-audio.mp3`

For more details, see [README.md](./README.md)
