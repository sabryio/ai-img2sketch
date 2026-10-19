//! The engine, with no edges.
//!
//! Everything in this crate is pure: the domain types, the ports that the outside world
//! implements, and the services and use cases that combine them. There is no filesystem, no
//! network, no async runtime, no clock and no native library here.
//!
//! That is not tidiness for its own sake — it is what makes the engine testable without a machine,
//! and what lets the same use cases drive a CLI, an HTTP server and (later) a desktop host. When a
//! rule needs to ask the world a question, the *question* is a port declared here and the *answer*
//! is an adapter in `img2sketch-media`:
//!
//! ```
//! use img2sketch_core::application::ports::FfmpegLocator;
//! use img2sketch_core::domain::FfmpegStatus;
//!
//! #[derive(Debug)]
//! struct NoFfmpeg;
//!
//! impl FfmpegLocator for NoFfmpeg {
//!     fn probe(&self) -> FfmpegStatus {
//!         FfmpegStatus::missing()
//!     }
//! }
//! ```
//!
//! `tests/architecture.rs` fails the build if this crate grows an edge.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod application;
pub mod domain;
