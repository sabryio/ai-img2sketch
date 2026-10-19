//! Writing frames into a video file.

use std::path::PathBuf;

use crate::domain::Frame;

/// Writes finished frames to a video, in the order they are given.
///
/// The encoder is a resource with a beginning and an end, so the trait is explicit about both: a
/// frame goes in one at a time, and [`release`](VideoWriter::release) finishes the file and hands
/// back its path. A writer that is dropped without being released must leave nothing behind that
/// a client could mistake for a result — a half-written MP4 that plays for two seconds is worse
/// than no file, because it looks like a success.
pub trait VideoWriter: std::fmt::Debug + Send {
    /// Appends one frame.
    ///
    /// # Errors
    ///
    /// Returns [`VideoWriterError`] when the encoder has failed, or when the frame does not
    /// match the size the writer was opened with.
    fn write_frame(&mut self, frame: &Frame) -> Result<(), VideoWriterError>;

    /// Finishes the file and returns its path.
    ///
    /// # Errors
    ///
    /// Returns [`VideoWriterError`] when the encoder cannot complete the file.
    fn release(self: Box<Self>) -> Result<PathBuf, VideoWriterError>;
}

/// Why writing a video failed.
#[derive(Debug, thiserror::Error)]
pub enum VideoWriterError {
    /// The encoder refused a frame or failed to finish.
    #[error("the encoder failed: {0}")]
    Encoding(String),
    /// A frame did not match the writer's size.
    #[error(
        "expected a {expected_width}x{expected_height} frame, got {actual_width}x{actual_height}"
    )]
    FrameSize {
        /// The size the writer was opened with.
        expected_width: u32,
        /// The size the writer was opened with.
        expected_height: u32,
        /// The size that arrived.
        actual_width: u32,
        /// The size that arrived.
        actual_height: u32,
    },
    /// The encoder process could not be started, or the file could not be moved into place.
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
