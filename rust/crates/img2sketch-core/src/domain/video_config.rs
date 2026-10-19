//! Every setting that changes what the drawing does.
//!
//! The defaults and ranges live here once and are pointed at by both surfaces: the CLI flags in
//! `img2sketch-cli` and the request body the API accepts. That is deliberate — the Python version
//! keeps the same numbers in three places, and drifting apart is how a "10" in the interface
//! becomes a "8" in the render.

use serde::{Deserialize, Serialize};

/// The default grid split length: how many pixels one drawn cell covers.
pub const DEFAULT_SPLIT_LEN: u32 = 10;
/// The default video frame rate.
pub const DEFAULT_FRAME_RATE: u32 = 25;
/// The default drawing skip rate — lower draws more of the image.
pub const DEFAULT_OBJECT_SKIP_RATE: u32 = 8;
/// The default time the finished colour image is held at the end.
pub const DEFAULT_END_DURATION_SEC: u32 = 2;

/// The accepted range for [`VideoConfig::split_len`].
pub const SPLIT_LEN_RANGE: std::ops::RangeInclusive<u32> = 5..=100;
/// The accepted range for [`VideoConfig::frame_rate`].
pub const FRAME_RATE_RANGE: std::ops::RangeInclusive<u32> = 1..=120;
/// The accepted range for [`VideoConfig::object_skip_rate`].
pub const OBJECT_SKIP_RATE_RANGE: std::ops::RangeInclusive<u32> = 1..=100;
/// The accepted range for [`VideoConfig::draw_duration_sec`], when it is set.
pub const DRAW_DURATION_RANGE: std::ops::RangeInclusive<f32> = 0.1..=600.0;
/// The accepted range for [`VideoConfig::end_duration_sec`].
pub const END_DURATION_RANGE: std::ops::RangeInclusive<u32> = 0..=10;

/// How a sketch video should be drawn.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct VideoConfig {
    /// Pixels one grid cell covers.
    pub split_len: u32,
    /// Frames per second of the result.
    pub frame_rate: u32,
    /// How many cells to skip between drawn ones.
    pub object_skip_rate: u32,
    /// Target length of the drawing phase in seconds. When set, it decides the skip rate and
    /// overrides [`Self::object_skip_rate`].
    pub draw_duration_sec: Option<f32>,
    /// Seconds the finished colour image is held after the drawing ends.
    pub end_duration_sec: u32,
}

/// Why a configuration was refused.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum VideoConfigError {
    /// A value fell outside the range the renderer supports.
    #[error("{field} must be between {min} and {max}, got {value}")]
    OutOfRange {
        /// Which setting.
        field: &'static str,
        /// The smallest accepted value.
        min: f32,
        /// The largest accepted value.
        max: f32,
        /// What was asked for.
        value: f32,
    },
}

impl Default for VideoConfig {
    fn default() -> Self {
        Self {
            split_len: DEFAULT_SPLIT_LEN,
            frame_rate: DEFAULT_FRAME_RATE,
            object_skip_rate: DEFAULT_OBJECT_SKIP_RATE,
            draw_duration_sec: None,
            end_duration_sec: DEFAULT_END_DURATION_SEC,
        }
    }
}

impl VideoConfig {
    /// Checks every field against its documented range.
    ///
    /// # Errors
    ///
    /// Returns [`VideoConfigError::OutOfRange`] naming the first field that is out of range.
    pub fn validate(&self) -> Result<(), VideoConfigError> {
        check_side("split length", self.split_len, SPLIT_LEN_RANGE)?;
        check_side("frame rate", self.frame_rate, FRAME_RATE_RANGE)?;
        check_side(
            "object skip rate",
            self.object_skip_rate,
            OBJECT_SKIP_RATE_RANGE,
        )?;
        check_side("end duration", self.end_duration_sec, END_DURATION_RANGE)?;
        if let Some(duration) = self.draw_duration_sec {
            check_duration("draw duration", duration, DRAW_DURATION_RANGE)?;
        }
        Ok(())
    }

    /// Whether the caller asked for a specific drawing length.
    #[must_use]
    pub const fn uses_draw_duration(&self) -> bool {
        self.draw_duration_sec.is_some()
    }
}

/// Checks a whole-number setting against its range.
fn check_side(
    field: &'static str,
    value: u32,
    range: std::ops::RangeInclusive<u32>,
) -> Result<(), VideoConfigError> {
    if range.contains(&value) {
        Ok(())
    } else {
        Err(VideoConfigError::OutOfRange {
            field,
            min: *range.start() as f32,
            max: *range.end() as f32,
            value: value as f32,
        })
    }
}

/// Checks a fractional setting against its range.
fn check_duration(
    field: &'static str,
    value: f32,
    range: std::ops::RangeInclusive<f32>,
) -> Result<(), VideoConfigError> {
    if range.contains(&value) {
        Ok(())
    } else {
        Err(VideoConfigError::OutOfRange {
            field,
            min: *range.start(),
            max: *range.end(),
            value,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DRAW_DURATION_RANGE, FRAME_RATE_RANGE, OBJECT_SKIP_RATE_RANGE, SPLIT_LEN_RANGE,
        VideoConfig, VideoConfigError,
    };

    #[test]
    fn defaults_match_the_documented_ones() {
        let config = VideoConfig::default();
        assert_eq!(config.split_len, 10);
        assert_eq!(config.frame_rate, 25);
        assert_eq!(config.object_skip_rate, 8);
        assert_eq!(config.draw_duration_sec, None);
        assert_eq!(config.end_duration_sec, 2);
        assert!(!config.uses_draw_duration());
        config.validate().unwrap();
    }

    #[test]
    fn accepts_the_edges_of_every_range() {
        for value in [*SPLIT_LEN_RANGE.start(), *SPLIT_LEN_RANGE.end()] {
            VideoConfig {
                split_len: value,
                ..VideoConfig::default()
            }
            .validate()
            .unwrap();
        }
        for value in [*FRAME_RATE_RANGE.start(), *FRAME_RATE_RANGE.end()] {
            VideoConfig {
                frame_rate: value,
                ..VideoConfig::default()
            }
            .validate()
            .unwrap();
        }
        for value in [
            *OBJECT_SKIP_RATE_RANGE.start(),
            *OBJECT_SKIP_RATE_RANGE.end(),
        ] {
            VideoConfig {
                object_skip_rate: value,
                ..VideoConfig::default()
            }
            .validate()
            .unwrap();
        }
        for value in [*DRAW_DURATION_RANGE.start(), *DRAW_DURATION_RANGE.end()] {
            VideoConfig {
                draw_duration_sec: Some(value),
                ..VideoConfig::default()
            }
            .validate()
            .unwrap();
        }
    }

    #[test]
    fn refuses_the_first_value_past_a_range() {
        let error = VideoConfig {
            split_len: 101,
            ..VideoConfig::default()
        }
        .validate()
        .unwrap_err();
        assert_eq!(
            error,
            VideoConfigError::OutOfRange {
                field: "split length",
                min: 5.0,
                max: 100.0,
                value: 101.0
            }
        );

        let error = VideoConfig {
            frame_rate: 0,
            ..VideoConfig::default()
        }
        .validate()
        .unwrap_err();
        assert!(error.to_string().contains("frame rate"));

        let error = VideoConfig {
            draw_duration_sec: Some(0.0),
            ..VideoConfig::default()
        }
        .validate()
        .unwrap_err();
        assert!(error.to_string().contains("draw duration"));

        let error = VideoConfig {
            end_duration_sec: 11,
            ..VideoConfig::default()
        }
        .validate()
        .unwrap_err();
        assert!(error.to_string().contains("end duration"));
    }

    #[test]
    fn a_draw_duration_takes_over_from_the_skip_rate() {
        let config = VideoConfig {
            draw_duration_sec: Some(5.0),
            ..VideoConfig::default()
        };
        assert!(config.uses_draw_duration());
        assert_eq!(
            config.object_skip_rate, 8,
            "the field stays as it was given"
        );
    }
}
