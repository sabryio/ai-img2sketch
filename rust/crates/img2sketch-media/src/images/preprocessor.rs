//! The image preprocessor: resize, greyscale, threshold.
//!
//! Three steps, each in its own module, composed here so the use case sees one call. The block size
//! and constant are fields rather than constants so a parity test can pin the exact numbers the
//! Python engine uses — and so a future settings screen could expose them without touching the
//! drawing loop.

use img2sketch_core::application::ports::{ImagePreprocessor, PreprocessError, PreprocessedImage};
use img2sketch_core::domain::{Dimensions, Frame};

use super::resize::resize_area;
use super::threshold::{
    DEFAULT_BLOCK_SIZE, DEFAULT_CONSTANT, gaussian_adaptive_threshold, to_grayscale,
};

/// Preprocesses an image the way the Python engine's OpenCV preprocessor does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GaussianAdaptivePreprocessor {
    /// The neighbourhood the local mean is taken over, in pixels.
    pub block_size: u32,
    /// How much darker than its neighbourhood a pixel has to be to count as ink.
    pub constant: i32,
}

impl Default for GaussianAdaptivePreprocessor {
    fn default() -> Self {
        Self {
            block_size: DEFAULT_BLOCK_SIZE,
            constant: DEFAULT_CONSTANT,
        }
    }
}

impl ImagePreprocessor for GaussianAdaptivePreprocessor {
    fn preprocess(
        &self,
        image: &Frame,
        target: Dimensions,
    ) -> Result<PreprocessedImage, PreprocessError> {
        let original = resize_area(image, target)?;
        let grayscale = to_grayscale(&original)?;
        let thresholded = gaussian_adaptive_threshold(&grayscale, self.block_size, self.constant)?;

        Ok(PreprocessedImage::new(
            original,
            grayscale,
            thresholded,
            target,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::GaussianAdaptivePreprocessor;
    use img2sketch_core::application::ports::ImagePreprocessor;
    use img2sketch_core::domain::{Dimensions, Frame};

    #[test]
    fn produces_three_views_of_one_canvas() {
        let frame = Frame::filled(Dimensions::new(40, 20).unwrap(), [120, 130, 140]);
        let target = Dimensions::new(20, 20).unwrap();

        let preprocessed = GaussianAdaptivePreprocessor::default()
            .preprocess(&frame, target)
            .unwrap();

        assert_eq!(preprocessed.dimensions(), target);
        assert_eq!(preprocessed.original().dimensions(), target);
        assert_eq!(preprocessed.grayscale().dimensions(), target);
        assert_eq!(preprocessed.thresholded().dimensions(), target);
    }

    #[test]
    fn a_uniform_image_has_no_ink_whatever_its_brightness() {
        // Nothing is darker than its own neighbourhood, so nothing is drawn. This is the case that
        // makes the "a run with nothing to draw still writes a frame" promise load-bearing.
        for value in [0u8, 90, 255] {
            let frame = Frame::filled(Dimensions::new(30, 30).unwrap(), [value; 3]);
            let preprocessed = GaussianAdaptivePreprocessor::default()
                .preprocess(&frame, Dimensions::new(30, 30).unwrap())
                .unwrap();

            assert!(
                preprocessed
                    .thresholded()
                    .pixels()
                    .iter()
                    .all(|pixel| *pixel == 255),
                "a flat {value} canvas has no ink"
            );
        }
    }
}
