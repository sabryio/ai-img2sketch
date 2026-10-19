//! The boundary between the engine and everything that touches the machine.
//!
//! A port is a trait declared here and implemented in `img2sketch-media`. Two rules keep this
//! honest:
//!
//! 1. **A port never leaks an implementation.** No `tokio` type, no `image` type, no `ffmpeg`
//!    type, no file handle. If a port returns a path, it returns a `PathBuf`; if it returns
//!    pixels, it returns a [`Frame`](crate::domain::Frame).
//! 2. **A port answers a question, not a wish.** `FfmpegLocator::probe` reports what is true;
//!    a port that could return "maybe" would push the decision back into the caller.
//!
//! Traits exist where a test fakes them or a second adapter could appear. Everything else is a
//! function.

pub mod ffmpeg_locator;
pub mod video_writer;

pub use ffmpeg_locator::FfmpegLocator;
pub use video_writer::{VideoWriter, VideoWriterError};
