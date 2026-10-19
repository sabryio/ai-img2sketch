//! Reading a source image into an engine frame.
//!
//! A separate port from the preprocessor because the two answer different questions: this one is
//! "what is in this file", the other is "what will be drawn from it". A batch run loads many
//! images and draws one video from each, so loading has to be a step of its own.

use std::path::{Path, PathBuf};

use crate::domain::Frame;

/// Reads an image file.
pub trait ImageLoader: std::fmt::Debug + Send + Sync {
    /// Loads one image.
    ///
    /// # Errors
    ///
    /// Returns [`ImageLoadError`] when the file is missing, is not an image, or is too large.
    fn load(&self, path: &Path) -> Result<Frame, ImageLoadError>;
}

/// Why an image could not be read.
#[derive(Debug, thiserror::Error)]
pub enum ImageLoadError {
    /// The file could not be read or decoded.
    #[error("could not read {path}: {message}")]
    Unreadable {
        /// The file that was asked for.
        path: PathBuf,
        /// What the decoder said.
        message: String,
    },
}
