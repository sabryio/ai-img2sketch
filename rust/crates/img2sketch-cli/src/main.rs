//! `img2sketch` — the command line surface.
//!
//! The flags, their ranges and their defaults are the ones `presentation/cli.py` documents, so an
//! existing script keeps working against this binary. They are **not** invented here: every default
//! comes from [`img2sketch_core::domain`], which is also where the API reads them. One definition,
//! three surfaces, no drift.
//!
//! This binary is a translation layer. It parses, it calls a use case, it prints the result — and
//! where the use case does not exist yet it says so instead of pretending. It is deliberately not
//! async: the CLI has one job at a time, and an async runtime it does not need would be a
//! dependency every user pays for.

use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use clap::{Args, Parser, Subcommand};
use img2sketch_core::application::ports::FfmpegLocator;
use img2sketch_core::application::services::DimensionAdjuster;
use img2sketch_core::domain::{
    DEFAULT_END_DURATION_SEC, DEFAULT_FRAME_RATE, DEFAULT_OBJECT_SKIP_RATE, DEFAULT_SPLIT_LEN,
    VideoConfig,
};
use img2sketch_media::ffmpeg::SystemFfmpegLocator;
use img2sketch_media::images::load_frame;

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
    };
    config.validate()?;
    Ok(config)
}

/// Says what would be drawn, and stops — the drawing loop is ROADMAP Phase 3.
fn generate(args: &GenerateArgs) -> Result<()> {
    let config = config_from(args)?;

    println!("Source:  {}", args.source.display());
    if args.source.is_dir() {
        println!("Plan:    one video per image found directly inside the folder");
    } else {
        let frame = load_frame(&args.source)
            .with_context(|| format!("could not read {}", args.source.display()))?;
        let dimensions = frame.dimensions();
        println!("Image:   {}x{}", dimensions.width(), dimensions.height());

        let adjusted = DimensionAdjuster::adjust_to_multiple(dimensions, config.split_len)?;
        if adjusted != dimensions {
            println!(
                "Grid:    rounded to {}x{} for a split length of {}",
                adjusted.width(),
                adjusted.height(),
                config.split_len
            );
        }
        let encoded = dimensions.even_for_encoder();
        if encoded != dimensions {
            println!(
                "Encoder: the canvas grows to {}x{} so every chrome can decode it",
                encoded.width(),
                encoded.height()
            );
        }
    }

    if let Some(directory) = &args.output {
        println!("Output:  {}", directory.display());
    }
    println!("Config:  split-len {}", describe_config(&config));

    let status = SystemFfmpegLocator::from_environment().probe();
    println!("FFmpeg:  {}", status.summary());

    bail!("generating videos is not implemented in the Rust engine yet — see ROADMAP Phase 3")
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
