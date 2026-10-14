#!/usr/bin/env bun

/**
 * Process images with voice-overs
 * Reads a JSON file with [{image: "", voice: ""}] format
 * Detects voice duration and generates videos accordingly
 *
 * All paths are resolved to absolute paths for cross-directory compatibility
 */

import { $ } from "bun";
import { parseArgs } from "util";
import { resolve, dirname, isAbsolute } from "path";
import { existsSync } from "fs";

interface ImageVoicePair {
  image: string;
  voice: string;
}

interface ProcessResult {
  success: boolean;
  image: string;
  error?: string;
}

/**
 * Resolve a path to absolute, relative to the config file directory
 */
function resolvePathFromConfig(path: string, configDir: string): string {
  if (isAbsolute(path)) {
    return path;
  }
  return resolve(configDir, path);
}

/**
 * Get the duration of an audio file in seconds using ffprobe
 */
async function getAudioDuration(audioPath: string): Promise<number> {
  // Ensure absolute path
  const absolutePath = isAbsolute(audioPath) ? audioPath : resolve(audioPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Audio file not found: ${absolutePath}`);
  }

  try {
    const result =
      await $`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${absolutePath}`.text();
    const duration = parseFloat(result.trim());

    if (isNaN(duration)) {
      throw new Error(`Invalid duration for ${absolutePath}`);
    }

    return duration;
  } catch (error) {
    console.error(`Error getting duration for ${absolutePath}:`, error);
    throw error;
  }
}

/**
 * Generate a sketch video for an image with specific duration.
 *
 * `endDuration` is only applied to the last image; pass `undefined` for every
 * other image so the CLI's own default end duration applies.
 */
async function generateSketchVideo(
  imagePath: string,
  outputDir: string,
  drawDuration: number,
  endDuration: number | undefined,
  index: number,
  total: number,
): Promise<void> {
  // Ensure absolute paths
  const absoluteImagePath = isAbsolute(imagePath)
    ? imagePath
    : resolve(imagePath);
  const absoluteOutputDir = isAbsolute(outputDir)
    ? outputDir
    : resolve(outputDir);

  if (!existsSync(absoluteImagePath)) {
    throw new Error(`Image file not found: ${absoluteImagePath}`);
  }

  console.log(`\n[${index + 1}/${total}] Processing: ${absoluteImagePath}`);
  console.log(
    endDuration === undefined
      ? `  Draw duration: ${drawDuration.toFixed(2)}s`
      : `  Draw duration: ${drawDuration.toFixed(2)}s, End duration: ${endDuration}s`,
  );

  const args = [
    "img2sketch",
    "generate",
    absoluteImagePath,
    "--output",
    absoluteOutputDir,
    "--draw-duration",
    drawDuration.toString(),
  ];

  // Only the last image gets an explicit --end-duration (0 = no trailing hold).
  if (endDuration !== undefined) {
    args.push("--end-duration", endDuration.toString());
  }

  try {
    await $`${args}`;
    console.log(`  ✓ Generated video for ${absoluteImagePath}`);
  } catch (error) {
    console.error(
      `  ✗ Failed to generate video for ${absoluteImagePath}:`,
      error,
    );
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      input: {
        type: "string",
        short: "i",
        default: "./config.json",
      },
      output: {
        type: "string",
        short: "o",
        default: "./videos",
      },
      help: {
        type: "boolean",
        short: "h",
      },
    },
    strict: true,
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Usage: bun process-videos.ts [options]

Options:
  -i, --input <path>   Path to JSON config file (default: ./config.json)
                       Can be relative to current directory or absolute
  -o, --output <path>  Output directory for videos (default: ./videos)
                       Can be relative to current directory or absolute
  -h, --help           Show this help message

JSON Format:
[
  { "image": "path/to/image1.jpg", "voice": "path/to/voice1.mp3" },
  { "image": "path/to/image2.jpg", "voice": "path/to/voice2.mp3" }
]

Path Resolution:
- All paths are converted to absolute paths
- Paths in --input and --output are resolved relative to the CURRENT DIRECTORY
- Paths in the JSON config (image/voice) are resolved relative to the CONFIG FILE location
- This allows you to run the script from any directory on your computer

Example:
  # Run from anywhere with absolute paths
  bun /path/to/process-videos.ts -i D:/projects/my-videos/config.json -o D:/output

  # Or with relative paths (resolved from current directory)
  cd D:/projects/my-videos
  bun /path/to/process-videos.ts -i config.json -o ./output

The script will:
1. Read the JSON config file
2. Detect the duration of each voice file
3. Generate sketch videos in parallel, with draw-duration matching the voice
4. Only the last image gets --end-duration 0 (no trailing hold)
5. Every other image omits --end-duration (CLI default applies)
`);
    process.exit(0);
  }

  const inputFile = values.input!;
  const outputDir = values.output!;

  // Resolve all paths to absolute
  const absoluteInputFile = isAbsolute(inputFile)
    ? inputFile
    : resolve(inputFile);
  const absoluteOutputDir = isAbsolute(outputDir)
    ? outputDir
    : resolve(outputDir);

  console.log(`📄 Reading config from: ${absoluteInputFile}`);
  console.log(`📁 Output directory: ${absoluteOutputDir}`);

  // Get the directory of the config file for resolving relative paths
  const configDir = dirname(absoluteInputFile);

  // Read and parse JSON file
  let config: ImageVoicePair[];
  try {
    if (!existsSync(absoluteInputFile)) {
      throw new Error(`Config file not found: ${absoluteInputFile}`);
    }

    const file = Bun.file(absoluteInputFile);
    config = await file.json();

    if (!Array.isArray(config)) {
      throw new Error("JSON file must contain an array");
    }

    if (config.length === 0) {
      throw new Error("JSON file is empty");
    }

    // Validate structure and resolve paths relative to config file
    for (const item of config) {
      if (!item.image || !item.voice) {
        throw new Error("Each item must have 'image' and 'voice' properties");
      }

      // Resolve paths relative to config file directory
      item.image = resolvePathFromConfig(item.image, configDir);
      item.voice = resolvePathFromConfig(item.voice, configDir);
    }
  } catch (error) {
    console.error(`❌ Error reading config file: ${error}`);
    process.exit(1);
  }

  console.log(`\n✓ Found ${config.length} image-voice pair(s)\n`);

  // Ensure output directory exists
  await $`mkdir -p ${absoluteOutputDir}`.quiet();

  // Process every image-voice pair in parallel.
  // `Promise.all` preserves the input order of the results for the summary.
  const total = config.length;

  const results: ProcessResult[] = await Promise.all(
    config.map(async (pair, i): Promise<ProcessResult> => {
      const isLast = i === total - 1;

      try {
        // Get voice duration
        console.log(`🎵 Detecting duration for: ${pair.voice}`);
        const voiceDuration = await getAudioDuration(pair.voice);
        console.log(`  Duration: ${voiceDuration.toFixed(2)} seconds`);

        // Generate video with appropriate parameters
        // Only the last image gets --end-duration 0 (no trailing hold).
        // Every other image omits --end-duration entirely.
        const endDuration = isLast ? 0 : undefined;

        await generateSketchVideo(
          pair.image,
          absoluteOutputDir,
          voiceDuration,
          endDuration,
          i,
          total,
        );

        return { success: true, image: pair.image };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return { success: false, image: pair.image, error: errorMsg };
      }
    }),
  );

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 SUMMARY");
  console.log("=".repeat(60));

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`✓ Successful: ${successful}/${total}`);
  if (failed > 0) {
    console.log(`✗ Failed: ${failed}/${total}`);
    console.log("\nFailed images:");
    results
      .filter((r) => !r.success)
      .forEach((r) => console.log(`  - ${r.image}: ${r.error}`));
  }

  console.log(`\n📁 Videos saved to: ${absoluteOutputDir}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
