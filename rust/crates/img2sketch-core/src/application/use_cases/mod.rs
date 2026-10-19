//! One thing a caller can ask the engine to do.
//!
//! A use case owns the sequence and nothing else: it reads the settings, asks the services what
//! the plan is, drives the ports, and reports progress — but it never touches a file, a socket or
//! a library. That is what lets the same use case serve the CLI, the HTTP server and (later) the
//! desktop host, and what lets every one of them be tested with fakes.
//!
//! - [`generate_sketch_video`] — one image, one video.
//! - [`generate_batch_videos`] — a folder of images, one video each, with per-item results.
//!
//! Each keeps the contract the Python use cases already have: progress is reported through the
//! port, monotonic and throttled; a run that skips every cell still writes one frame, so a success
//! never hands back no file.

pub mod generate_batch_videos;
pub mod generate_sketch_video;

pub use generate_batch_videos::{BatchItem, BatchSummary, GenerateBatchVideos};
pub use generate_sketch_video::{GenerateError, GenerateSketchVideo, PROGRESS_STEP_PERCENT};

use std::path::{Path, PathBuf};

use crate::application::ports::ProgressReporter;
use crate::domain::{Frame, ObjectMask, VideoConfig};

/// Draws one image into one video.
///
/// This is what a batch run needs and what a single run is: the batch asks this question once per
/// image, so it can report one image's failure without ending the run, and so it can be tested
/// without an encoder at all. [`GenerateSketchVideo`] is the real implementation; a test is the
/// second one, which is the reason it is a trait rather than a direct call.
pub trait SketchRenderer: std::fmt::Debug + Send + Sync {
    /// Draws `image` into `output` and returns the file that was written.
    ///
    /// # Errors
    ///
    /// Returns [`GenerateError`] when the image cannot be drawn; a batch run turns that into one
    /// failed item.
    fn render(
        &self,
        image: &Frame,
        config: &VideoConfig,
        output: &Path,
        object_masks: &[ObjectMask],
        progress: Option<&dyn ProgressReporter>,
    ) -> Result<PathBuf, GenerateError>;
}

impl SketchRenderer for GenerateSketchVideo {
    fn render(
        &self,
        image: &Frame,
        config: &VideoConfig,
        output: &Path,
        object_masks: &[ObjectMask],
        progress: Option<&dyn ProgressReporter>,
    ) -> Result<PathBuf, GenerateError> {
        self.execute(image, config, output, object_masks, progress)
    }
}
