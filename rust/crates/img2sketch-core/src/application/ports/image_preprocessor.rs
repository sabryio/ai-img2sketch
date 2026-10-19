//! Turning a source image into the three things the drawing needs.

use crate::domain::{Dimensions, Frame, FrameError, GrayImage, GrayImageError};

/// An image the drawing can work from, at the size it will be drawn at.
///
/// Three views of one image, and each is there for a reason:
///
/// - `thresholded` is what the drawing copies, cell by cell, into the frame: ink or paper.
/// - `grayscale` is what the threshold was computed from, kept so a failure can be looked at
///   without re-deriving it.
/// - `original` is the finished picture: the frames held at the end of the video, resized to the
///   same canvas as everything else.
#[derive(Debug, Clone, PartialEq)]
pub struct PreprocessedImage {
    original: Frame,
    grayscale: GrayImage,
    thresholded: GrayImage,
    dimensions: Dimensions,
}

impl PreprocessedImage {
    /// Collects the three views of one preprocessed image.
    #[must_use]
    pub const fn new(
        original: Frame,
        grayscale: GrayImage,
        thresholded: GrayImage,
        dimensions: Dimensions,
    ) -> Self {
        Self {
            original,
            grayscale,
            thresholded,
            dimensions,
        }
    }

    /// The finished image, in colour, at the drawing's canvas size.
    #[must_use]
    pub const fn original(&self) -> &Frame {
        &self.original
    }

    /// The image in one channel, before thresholding.
    #[must_use]
    pub const fn grayscale(&self) -> &GrayImage {
        &self.grayscale
    }

    /// The image reduced to ink and paper.
    #[must_use]
    pub const fn thresholded(&self) -> &GrayImage {
        &self.thresholded
    }

    /// The canvas size everything above is expressed in.
    #[must_use]
    pub const fn dimensions(&self) -> Dimensions {
        self.dimensions
    }
}

/// Resizes and thresholds a source image.
///
/// The port exists because this is the one place in the pipeline where the answer depends on a
/// library's arithmetic rather than on the engine's own: resampling and a Gaussian local mean both
/// have many defensible implementations, and only one of them matches the Python engine.
pub trait ImagePreprocessor: std::fmt::Debug + Send + Sync {
    /// Prepares an image for a drawing of the given size.
    ///
    /// # Errors
    ///
    /// Returns [`PreprocessError`] when the intermediate images cannot be built — which in
    /// practice means the sizes did not come out as the dimensions said they would.
    fn preprocess(
        &self,
        image: &Frame,
        target: Dimensions,
    ) -> Result<PreprocessedImage, PreprocessError>;
}

/// Why an image could not be preprocessed.
#[derive(Debug, thiserror::Error)]
pub enum PreprocessError {
    /// A resized frame did not match its own size.
    #[error(transparent)]
    Frame(#[from] FrameError),
    /// A derived single-channel image did not match its own size.
    #[error(transparent)]
    Gray(#[from] GrayImageError),
}
