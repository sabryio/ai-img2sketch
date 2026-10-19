//! Dumps the three preprocessing stages to PNG, for the parity gate in `docs/parity.md`.
//!
//! The gate compares this engine's resample, luma and local mean against `cv2`'s, pixel by pixel,
//! and the comparison is only legible if both sides can be written out. This is the Rust side:
//! it reads a source image, takes it through [`GaussianAdaptivePreprocessor`], and writes what
//! each step produced. Its Python counterpart is in `docs/parity.md`.
//!
//! Run it with the source and an output directory:
//!
//! ```text
//! cargo run -p img2sketch-media --example preprocess_stages -- output/parity/sample.png output/parity/rust-stages
//! ```

use std::path::PathBuf;

use img2sketch_core::application::ports::ImagePreprocessor;
use img2sketch_core::domain::Dimensions;
use img2sketch_media::images::{GaussianAdaptivePreprocessor, load_frame};

/// The canvas the parity gate measures on: 397x303 onto 400x300, which shrinks one axis and grows
/// the other, so it exercises the bilinear path as well as the area one.
fn canvas() -> Result<Dimensions, Box<dyn std::error::Error>> {
    Ok(Dimensions::new(400, 300)?)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let canvas = canvas()?;
    let mut arguments = std::env::args_os().skip(1);
    let source = PathBuf::from(arguments.next().ok_or("usage: source.png out-dir")?);
    let output = PathBuf::from(arguments.next().ok_or("usage: source.png out-dir")?);

    let frame = load_frame(&source)?;
    let preprocessed = GaussianAdaptivePreprocessor::default().preprocess(&frame, canvas)?;

    std::fs::create_dir_all(&output)?;
    write(
        &output.join("resized.png"),
        preprocessed.original().rgb(),
        canvas,
        3,
    )?;
    write(
        &output.join("grey.png"),
        preprocessed.grayscale().pixels(),
        canvas,
        1,
    )?;
    write(
        &output.join("thresholded.png"),
        preprocessed.thresholded().pixels(),
        canvas,
        1,
    )?;

    println!("{}", output.display());
    Ok(())
}

/// Writes one stage, whichever channel count it has.
fn write(
    path: &std::path::Path,
    bytes: &[u8],
    dimensions: Dimensions,
    channels: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let buffer = match channels {
        3 => image::RgbImage::from_raw(dimensions.width(), dimensions.height(), bytes.to_vec())
            .map(image::DynamicImage::ImageRgb8),
        _ => image::GrayImage::from_raw(dimensions.width(), dimensions.height(), bytes.to_vec())
            .map(image::DynamicImage::ImageLuma8),
    }
    .ok_or("the stage buffer did not match the canvas")?;

    buffer.save(path)?;
    Ok(())
}
