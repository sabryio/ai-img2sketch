//! The rounding OpenCV's fixed-point helpers do, in one place.
//!
//! Two primitives, both `cvRound`, which on every x86 build rounds to nearest with ties to even —
//! Rust's `round_ties_even`, not its `round`, which takes ties away from zero. The engine's
//! resampling and its local mean both finish by converting to `uchar`, and both must round the way
//! OpenCV's does: a pixel sitting exactly between two values is the one pixel a whole frame's
//! similarity turns on, because the route that draws the outline is chaotic.

/// `cvRound`: nearest, ties to even.
pub(crate) fn nearest_even(value: f32) -> i32 {
    value.round_ties_even() as i32
}

/// `saturate_cast<uchar>(float)`: `cvRound`, then clamp into `0..=255`.
pub(crate) fn to_byte(value: f32) -> u8 {
    nearest_even(value).clamp(0, 255) as u8
}
