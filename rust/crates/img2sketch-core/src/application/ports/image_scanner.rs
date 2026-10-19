//! Finding the images in a folder.
//!
//! Only the top level is scanned. A folder of holiday photos is the intended input, and recursing
//! into it would pick up thumbnails, caches and editor sidecars that the user never meant to draw.
//! The order is by name, so two runs over the same folder produce the same list.

use std::path::{Path, PathBuf};

/// Lists the images in a directory.
pub trait ImageScanner: std::fmt::Debug + Send + Sync {
    /// The image files directly inside `directory`, sorted by name.
    ///
    /// # Errors
    ///
    /// Returns [`ScanError`] when the path is not a directory, or cannot be read.
    fn find_images(&self, directory: &Path) -> Result<Vec<PathBuf>, ScanError>;
}

/// Why a directory could not be scanned.
#[derive(Debug, thiserror::Error)]
pub enum ScanError {
    /// The path is not a directory.
    #[error("not a directory: {0}")]
    NotADirectory(PathBuf),
    /// The directory could not be listed.
    #[error("could not list {path}: {message}")]
    Unreadable {
        /// The directory that was asked for.
        path: PathBuf,
        /// What the filesystem said.
        message: String,
    },
}
