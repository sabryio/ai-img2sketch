//! Adapters: everything that touches the machine.
//!
//! This crate implements the ports declared in [`img2sketch_core::application::ports`] and is the
//! only place allowed to reach for a file, a process or a library. It knows nothing about HTTP or
//! argument parsing, so a presentation crate may depend on it and never the other way round.
//!
//! The pieces that exist so far:
//!
//! - [`ffmpeg`] — finding the FFmpeg executable on the user's machine, asking what it can do, and
//!   driving it as a subprocess to write the video.
//! - [`images`] — reading a source image into an engine [`Frame`](img2sketch_core::domain::Frame).

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod ffmpeg;
pub mod images;
