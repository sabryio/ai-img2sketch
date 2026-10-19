//! FFmpeg: finding it, asking what it can do, and driving it.
//!
//! FFmpeg is invoked as a **subprocess**, never linked. Every Rust binding crate
//! (`ffmpeg-next`, `ffmpeg-the-third`, `rsmpeg`) runs `bindgen` against libclang at build time,
//! which would make a C++/LLVM toolchain a prerequisite for compiling this repository and would
//! make the shipped desktop app depend on shared `avcodec`/`swscale` DLLs at load time. Invoking
//! an executable instead keeps the build free of native requirements and turns "is FFmpeg here?"
//! into a product question with a visible answer.
//!
//! The pieces, smallest first:
//!
//! - [`encoder`] — the exact command line, as a pure value, so it can be asserted in a test.
//! - [`probe`] — the machine as this module sees it: filesystem, environment, process.
//! - [`candidates`] — the places an FFmpeg might be, one type per kind of place.
//! - [`locator`] — searching them in order of trust and reporting what was found.
//! - [`writer`] — the [`VideoWriter`](img2sketch_core::application::ports::VideoWriter) adapter.

pub mod candidates;
pub mod encoder;
pub mod locator;
pub mod probe;
pub mod writer;

pub use encoder::EncodeRequest;
pub use locator::SystemFfmpegLocator;
pub use probe::{LocateEnvironment, SystemEnvironment};
pub use writer::FfmpegVideoWriter;
