//! Finding the FFmpeg the app will draw with.

use crate::domain::FfmpegStatus;

/// Locates FFmpeg and reports what it found.
///
/// Absence is a value, not an error. A user whose machine has no FFmpeg needs to be told what is
/// missing, where the app looked, and what to do — which is a state to render, not an error to
/// discard. That is also why this returns [`FfmpegStatus`] rather than a `Result`:
/// "not installed" is an ordinary outcome that the interface has a case for.
///
/// # Examples
///
/// ```
/// use img2sketch_core::application::ports::FfmpegLocator;
/// use img2sketch_core::domain::{FfmpegSource, FfmpegStatus};
///
/// #[derive(Debug)]
/// struct FakeFfmpeg;
///
/// impl FfmpegLocator for FakeFfmpeg {
///     fn probe(&self) -> FfmpegStatus {
///         FfmpegStatus::found("ffmpeg".into(), FfmpegSource::Path, Some("9.0.1".into()), Some(true))
///     }
/// }
///
/// let status = FakeFfmpeg.probe();
/// assert!(status.can_encode_h264());
/// ```
pub trait FfmpegLocator: std::fmt::Debug + Send + Sync {
    /// Looks for FFmpeg, in order of trust, and reports the first usable answer.
    fn probe(&self) -> FfmpegStatus;
}
