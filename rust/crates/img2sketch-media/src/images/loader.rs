//! Turning a file the user picked into an engine frame.

use std::path::{Path, PathBuf};

use img2sketch_core::domain::{Dimensions, DimensionsError, Frame, FrameError};

/// Decodes an image into RGB8.
///
/// Two details matter for parity with the Python engine, and both are easy to get wrong silently:
///
/// - **Colour order.** `cv2.imread` hands back BGR and the Python pipeline carries that all the
///   way to the drawing loop. Here the frame is RGB, and the conversion happens once, in the video
///   writer, where FFmpeg expects it. Nothing outside this module should know either convention.
/// - **Orientation.** `cv2.imread` applies the EXIF orientation tag; the `image` crate does not.
///   A phone photo of a portrait subject is stored landscape with a tag saying "rotate 90", and a
///   sketch drawn from the unrotated pixels is a sideways sketch. The correct transform is applied
///   explicitly here rather than left to a default.
///
/// # Errors
///
/// Returns [`ImageError`] if the file cannot be decoded, is empty in either dimension, or is too
/// large for the engine to allocate.
pub fn load_frame(path: &Path) -> Result<Frame, ImageError> {
    let file = std::fs::File::open(path).map_err(|source| ImageError::Open {
        path: path.to_path_buf(),
        source,
    })?;

    // The reader is asked for the orientation before the pixels are decoded, so the rotation is
    // applied during decoding rather than as a second pass over the whole buffer.
    let reader = image::ImageReader::new(std::io::BufReader::new(file))
        .with_guessed_format()
        .map_err(|source| ImageError::Open {
            path: path.to_path_buf(),
            source,
        })?;
    // The `image` crate does not apply the EXIF orientation tag, and OpenCV does — a phone photo
    // of a portrait subject is stored landscape with a tag saying "rotate 90", so a sketch drawn
    // from the raw pixels comes out sideways. The orientation is read from the decoder and applied
    // explicitly, because parity with the Python engine depends on it.
    let mut decoder = reader.into_decoder().map_err(|source| ImageError::Decode {
        path: path.to_path_buf(),
        source,
    })?;
    let orientation = image::ImageDecoder::orientation(&mut decoder)
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut image =
        image::DynamicImage::from_decoder(decoder).map_err(|source| ImageError::Decode {
            path: path.to_path_buf(),
            source,
        })?;
    image.apply_orientation(orientation);

    let rgb = image.to_rgb8();
    let (width, height) = rgb.dimensions();
    let dimensions = Dimensions::new(width, height)?;
    Ok(Frame::new(dimensions, rgb.into_raw())?)
}

/// Why an image could not be read.
#[derive(Debug, thiserror::Error)]
pub enum ImageError {
    /// The file could not be opened or its format could not be recognised.
    #[error("could not open {path}: {source}")]
    Open {
        /// The file that was asked for.
        path: PathBuf,
        /// What the filesystem or decoder said.
        #[source]
        source: std::io::Error,
    },
    /// The bytes are not an image this build can decode.
    #[error("could not decode {path}: {source}")]
    Decode {
        /// The file that was asked for.
        path: PathBuf,
        /// What the decoder said.
        #[source]
        source: image::ImageError,
    },
    /// The image has no pixels.
    #[error(transparent)]
    Dimensions(#[from] DimensionsError),
    /// The decoded bytes did not match the size the decoder reported.
    #[error(transparent)]
    Frame(#[from] FrameError),
}

#[cfg(test)]
mod tests {
    use super::{ImageError, load_frame};
    use img2sketch_core::domain::Dimensions;

    #[test]
    fn loads_an_image_into_an_rgb_frame() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("square.png");
        image::RgbImage::from_pixel(2, 3, image::Rgb([10, 20, 30]))
            .save(&path)
            .unwrap();

        let frame = load_frame(&path).unwrap();
        assert_eq!(frame.dimensions(), Dimensions::new(2, 3).unwrap());
        assert_eq!(frame.rgb().len(), 2 * 3 * 3);
        assert_eq!(&frame.rgb()[..3], &[10, 20, 30]);
    }

    #[test]
    fn keeps_the_channels_in_the_order_it_promises() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("red.png");
        image::RgbImage::from_pixel(1, 1, image::Rgb([255, 0, 0]))
            .save(&path)
            .unwrap();

        // Red must still be first: an accidental BGR swap here would tint the whole sketch.
        assert_eq!(load_frame(&path).unwrap().rgb(), &[255, 0, 0]);
    }

    #[test]
    fn a_missing_file_is_an_error_naming_the_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("absent.png");
        let error = load_frame(&path).unwrap_err();
        assert!(matches!(error, ImageError::Open { .. }));
        assert!(error.to_string().contains("absent.png"));
    }

    #[test]
    fn a_file_that_is_not_an_image_is_an_error_naming_the_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("not-an-image.png");
        std::fs::write(&path, b"this is not a png").unwrap();
        let error = load_frame(&path).unwrap_err();
        assert!(
            error.to_string().contains("not-an-image.png"),
            "got: {error}"
        );
    }
}
