//! `img2sketch` — the command line surface.
//!
//! The flags, their ranges and their defaults are the ones `presentation/cli.py` documents, so an
//! existing script keeps working against this binary. They are **not** invented here: every default
//! comes from [`img2sketch_core::domain`], which is also where the API reads them. One definition,
//! three surfaces, no drift.
//!
//! This binary is a translation layer. It parses, it builds the adapters, it calls a use case, it
//! prints the result. It is deliberately not async: the CLI has one job at a time, and an async
//! runtime it does not need would be a dependency every user pays for.
//!
//! Progress goes to **standard error**, one line rewritten in place, because a long drawing is
//! otherwise indistinguishable from a hang — and because anything reading standard output deserves
//! to get the result and nothing else.

use std::io::Write;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use clap::{Args, Parser, Subcommand};
use img2sketch_core::application::ports::{FfmpegLocator, GenerationProgress, ProgressReporter};
use img2sketch_core::application::services::{DimensionAdjuster, VideoPathResolver};
use img2sketch_core::application::use_cases::{
    BatchSummary, GenerateBatchVideos, GenerateSketchVideo,
};
use img2sketch_core::domain::{
    DEFAULT_END_DURATION_SEC, DEFAULT_FRAME_RATE, DEFAULT_OBJECT_SKIP_RATE, DEFAULT_SPLIT_LEN,
    EncoderSettings, FfmpegStatus, ObjectMask, VideoConfig,
};
use img2sketch_media::ffmpeg::{FfmpegWriterFactory, SystemFfmpegLocator};
use img2sketch_media::images::{
    FileSystemImageLoader, FileSystemImageScanner, GaussianAdaptivePreprocessor, HandSource,
    load_frame,
};

/// Convert images to animated sketch videos.
#[derive(Debug, Parser)]
#[command(name = "img2sketch", version, about)]
struct Cli {
    /// The command to run.
    #[command(subcommand)]
    command: Command,
}

/// What the user asked for.
#[derive(Debug, Subcommand)]
enum Command {
    /// Generate sketch video(s) from an image or a folder of images
    Generate(Box<GenerateArgs>),
    /// Display information about an image and suggested settings
    Info(InfoArgs),
    /// Report whether FFmpeg is installed, and whether it can encode H.264
    Doctor,
}

/// Every setting that changes what the drawing does.
#[derive(Debug, Args)]
struct GenerateArgs {
    /// Image file, or a folder to process every image in
    source: PathBuf,

    /// Output directory (default: next to each image)
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// Grid split length (higher = faster sketch)
    #[arg(long, default_value_t = DEFAULT_SPLIT_LEN, value_parser = clap::value_parser!(u32).range(5..=100))]
    split_len: u32,

    /// Video frame rate (fps)
    #[arg(long, default_value_t = DEFAULT_FRAME_RATE, value_parser = clap::value_parser!(u32).range(1..=120))]
    frame_rate: u32,

    /// Drawing skip rate (lower = more detailed)
    #[arg(long, default_value_t = DEFAULT_OBJECT_SKIP_RATE, value_parser = clap::value_parser!(u32).range(1..=100))]
    object_skip_rate: u32,

    /// Target seconds for the drawing phase, floored (overrides --object-skip-rate)
    #[arg(long)]
    draw_duration: Option<f32>,

    /// Duration to show final colored image (seconds)
    #[arg(long, default_value_t = DEFAULT_END_DURATION_SEC, value_parser = clap::value_parser!(u32).range(0..=10))]
    end_duration: u32,

    /// Custom hand image path
    #[arg(long)]
    hand_image: Option<PathBuf>,

    /// Custom hand mask path
    #[arg(long)]
    hand_mask: Option<PathBuf>,

    /// JSON file describing ordered object masks (see README)
    #[arg(long)]
    object_masks: Option<PathBuf>,
}

/// What `info` needs.
#[derive(Debug, Args)]
struct InfoArgs {
    /// Image file to inspect
    image: PathBuf,

    /// Desired split length
    #[arg(long, default_value_t = DEFAULT_SPLIT_LEN)]
    split_len: u32,
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Generate(args) => generate(&args),
        Command::Info(args) => info(&args),
        Command::Doctor => doctor(),
    }
}

/// Turns the flags into the engine's own settings, and refuses anything out of range.
fn config_from(args: &GenerateArgs) -> Result<VideoConfig> {
    let config = VideoConfig {
        split_len: args.split_len,
        frame_rate: args.frame_rate,
        object_skip_rate: args.object_skip_rate,
        draw_duration_sec: args.draw_duration,
        end_duration_sec: args.end_duration,
        // Not a flag: the Python CLI does not expose it either, and the API's default is the same.
        ..VideoConfig::default()
    };
    config.validate()?;
    Ok(config)
}

/// Draws the video(s) the user asked for.
///
/// Everything that can be refused is refused before the first frame is drawn: the settings, the
/// encoder, the hand. A run that starts and then fails halfway has already written a large file, and
/// the user is left to work out which of the two problems they have.
fn generate(args: &GenerateArgs) -> Result<()> {
    let config = config_from(args)?;
    let executable = usable_executable(&SystemFfmpegLocator::from_environment().probe())?;
    let object_masks = load_object_masks(args)?;

    let engine = GenerateSketchVideo::new(
        Box::new(HandSource::from_files(
            args.hand_image.clone(),
            args.hand_mask.clone(),
        )),
        Box::new(GaussianAdaptivePreprocessor::default()),
        Box::new(FfmpegWriterFactory::new(
            executable,
            EncoderSettings::default(),
        )),
    );
    let progress = StandardErrorProgress;

    println!("Source:  {}", args.source.display());
    println!("Config:  split-len {}", describe_config(&config));

    if args.source.is_dir() {
        let batch = GenerateBatchVideos::new(
            Box::new(FileSystemImageLoader),
            Box::new(FileSystemImageScanner),
            Box::new(engine),
        );
        let summary = batch
            .execute(
                &args.source,
                &config,
                args.output.as_deref(),
                &object_masks,
                Some(&progress),
            )
            .with_context(|| format!("could not read {}", args.source.display()))?;
        report(&summary);

        if summary.failed() > 0 {
            // The exit code is the part a script branches on; the summary above is the part a
            // person reads. Both are needed, and neither replaces the other.
            bail!(
                "{} of {} video(s) could not be generated",
                summary.failed(),
                summary.total()
            );
        }
        return Ok(());
    }

    let frame = load_frame(&args.source)
        .with_context(|| format!("could not read {}", args.source.display()))?;
    let output = VideoPathResolver::resolve(&args.source, args.output.as_deref());
    let produced = engine.execute(&frame, &config, &output, &object_masks, Some(&progress))?;

    println!("Wrote:   {}", produced.display());
    Ok(())
}

/// The FFmpeg to draw with, or a refusal explaining what is missing.
fn usable_executable(status: &FfmpegStatus) -> Result<PathBuf> {
    match status.executable() {
        Some(path) if status.can_encode_h264() => Ok(path.to_path_buf()),
        _ => bail!(
            "{} Install FFmpeg (a build with libx264), or set IMG2SKETCH_FFMPEG to point at one.",
            status.summary()
        ),
    }
}

/// Reads the object masks file, which the Rust engine does not understand yet.
///
/// The flag is accepted so a script written against the Python CLI is not rejected for passing it —
/// but it is refused *before* a video is drawn, rather than being quietly ignored and producing a
/// drawing in the wrong order.
fn load_object_masks(args: &GenerateArgs) -> Result<Vec<ObjectMask>> {
    match &args.object_masks {
        None => Ok(Vec::new()),
        Some(path) => bail!(
            "ordered object masks are not supported by the Rust engine yet ({} was given) — \
             generate without --object-masks, or use the Python engine for this run",
            path.display()
        ),
    }
}

/// What a batch run did, one line per failure.
fn report(summary: &BatchSummary) {
    for item in summary.items().iter().filter(|item| !item.is_success()) {
        eprintln!(
            "  failed {}: {}",
            item.image_path().display(),
            item.error().unwrap_or("no reason given")
        );
    }
    println!(
        "Wrote:   {} of {} video(s)",
        summary.succeeded(),
        summary.total()
    );
}

/// Progress, as one line rewritten in place on standard error.
///
/// The use case already throttles reports to whole steps of the bar, so every report is worth
/// drawing. The line is padded to a fixed width so that shorter labels do not leave the tail of the
/// previous line behind.
#[derive(Debug, Clone, Copy)]
struct StandardErrorProgress;

impl ProgressReporter for StandardErrorProgress {
    fn report(&self, progress: &GenerationProgress) {
        let mut stderr = std::io::stderr();
        let line = format!(
            "\r  {:<12} {:>3}%  {} / {} frames",
            progress.label, progress.percent, progress.frame, progress.total_frames
        );
        let _ = write!(stderr, "{line:<64}");
        if progress.percent >= 100 {
            let _ = writeln!(stderr);
        }
    }
}

/// The settings, as one line.
fn describe_config(config: &VideoConfig) -> String {
    let duration = config.draw_duration_sec.map_or_else(
        || format!("object-skip-rate {}", config.object_skip_rate),
        |seconds| format!("draw-duration {seconds}s"),
    );
    format!(
        "{}, frame-rate {}, {}, end-duration {}s",
        config.split_len, config.frame_rate, duration, config.end_duration_sec
    )
}

/// Reads one image and reports what the engine would do with it.
fn info(args: &InfoArgs) -> Result<()> {
    let frame = load_frame(&args.image)
        .with_context(|| format!("could not read {}", args.image.display()))?;
    let dimensions = frame.dimensions();

    println!("Image:       {}", args.image.display());
    println!(
        "Dimensions:  {}x{} ({:.2}:1)",
        dimensions.width(),
        dimensions.height(),
        dimensions.aspect_ratio()
    );

    let adjusted = DimensionAdjuster::adjust_to_multiple(dimensions, args.split_len)?;
    if adjusted == dimensions {
        println!(
            "Compatible:  both sides divide by a split length of {}",
            args.split_len
        );
    } else {
        println!(
            "Adjusts to:  {}x{} for a split length of {}",
            adjusted.width(),
            adjusted.height(),
            args.split_len
        );
    }

    let suggestions = dimensions.find_common_divisors(&dimensions);
    let shown: Vec<String> = suggestions
        .iter()
        .take(10)
        .map(u32::to_string)
        .collect::<Vec<_>>();
    println!("Split sizes: {}", shown.join(", "));

    let encoded = dimensions.even_for_encoder();
    if encoded == dimensions {
        println!("Encodable:   yes, at this size");
    } else {
        println!(
            "Encodable:   padded to {}x{} (H.264 cannot hold an odd side)",
            encoded.width(),
            encoded.height()
        );
    }
    Ok(())
}

/// Reports what this machine can draw with.
///
/// It exits non-zero when the answer is "nothing usable", so a script or an installer can branch on
/// it without parsing the text.
fn doctor() -> Result<()> {
    let status = SystemFfmpegLocator::from_environment().probe();

    println!("{}", status.summary());
    println!();
    println!("Executable: {}", display_path(status.executable()));
    println!(
        "Found:      {}",
        status.source().map_or("nowhere", |source| source.label())
    );
    println!("Version:    {}", status.version().unwrap_or("unknown"));
    println!(
        "H.264:      {}",
        if status.can_encode_h264() {
            "yes (libx264)"
        } else {
            "no"
        }
    );

    if !status.can_encode_h264() {
        bail!(
            "FFmpeg is missing or cannot encode H.264, so no video can be written. Install FFmpeg \
             (a build with libx264), or set IMG2SKETCH_FFMPEG to point at one."
        );
    }
    Ok(())
}

/// A path for a person to read, or a dash when there is none.
fn display_path(path: Option<&std::path::Path>) -> String {
    path.map_or_else(|| "—".to_string(), |path| path.display().to_string())
}
