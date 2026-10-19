//! How a run tells the interface how far it has got.
//!
//! Progress is a *percentage*, not a tick: a sixty-frame video produces hundreds of frames, and
//! reporting each one would flood a socket with news the user cannot read. The use case decides
//! when a report is worth sending — every whole step of the bar, and always at the end — so a
//! reporter only has to render what it is given.
//!
//! Reports are monotonic. A percentage that goes backwards is a bug in the caller, and a bar that
//! jumps back and forth reads as a failure.

use std::path::PathBuf;

/// One progress report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenerationProgress {
    /// How much of the run is done, `0..=100`.
    pub percent: u32,
    /// Frames written so far.
    pub frame: u64,
    /// Frames the run expects to write in total.
    pub total_frames: u64,
    /// What is being drawn — an object's name, or `image` when nothing was masked.
    pub label: String,
    /// A still of the frame this report was taken from, when one was published.
    ///
    /// Publishing stills is the HTTP surface's job: a browser wants an image it can point an
    /// `<img>` at, and a CLI has nowhere to put one. Empty here means no publisher was attached.
    pub preview_path: Option<PathBuf>,
}

/// Renders progress.
pub trait ProgressReporter: std::fmt::Debug + Send + Sync {
    /// Receives one report.
    fn report(&self, progress: &GenerationProgress);
}

/// A reporter that discards everything, for callers with nobody listening.
#[derive(Debug, Clone, Copy, Default)]
pub struct SilentProgress;

impl ProgressReporter for SilentProgress {
    fn report(&self, _progress: &GenerationProgress) {}
}
