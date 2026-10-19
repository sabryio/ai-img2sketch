//! Where the drawing hand comes from.
//!
//! The app ships a hand; a user may bring their own. Both arrive through this port as a
//! [`Hand`], already cropped to its visible pixels, so the drawing never learns whether the hand
//! it is compositing came out of the binary or off the disk.
//!
//! It is a one-call port: the drawing needs a hand, not a hand-shaped search. When the hand is
//! missing, that is an error to report — unlike FFmpeg, a missing hand is not a state the app can
//! work around.

use crate::domain::{DimensionsError, FrameError, Hand, HandError};

/// Supplies the drawing hand.
pub trait HandProvider: std::fmt::Debug + Send + Sync {
    /// Loads the hand, or explains why it could not.
    ///
    /// # Errors
    ///
    /// Returns [`HandLoadError`] when the hand's files are missing, undecodable, or do not pair up.
    fn load(&self) -> Result<Hand, HandLoadError>;
}

/// Why a hand could not be loaded.
#[derive(Debug, thiserror::Error)]
pub enum HandLoadError {
    /// The hand image or its mask could not be read or decoded.
    #[error("could not read the drawing hand: {0}")]
    Unreadable(String),
    /// The hand image and mask did not describe the same thing.
    #[error(transparent)]
    Invalid(#[from] HandError),
    /// The cropped hand came out with no pixels, which means the mask's bounds were read wrongly.
    #[error(transparent)]
    Dimensions(#[from] DimensionsError),
    /// The cropped hand's pixels did not match its own size.
    #[error(transparent)]
    Frame(#[from] FrameError),
}
