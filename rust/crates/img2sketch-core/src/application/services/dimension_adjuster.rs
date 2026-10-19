//! Fitting an image's size to the grid the drawing algorithm uses.
//!
//! The drawing splits the canvas into equal `split_len` × `split_len` cells. A side that is not a
//! whole number of cells leaves a strip that belongs to no cell, so each side is rounded to the
//! nearest multiple of the split length before anything is drawn.
//!
//! This is a port of `application/services/dimension_adjuster.py`, including its rounding rule and
//! its refusal to produce a zero side. It is a port rather than a reinvention on purpose: a
//! different rounding here reshapes every video, and it would do so invisibly.

use crate::domain::{Dimensions, DimensionsError};

/// Rounds canvas sizes to the drawing grid.
#[derive(Debug, Clone, Copy, Default)]
pub struct DimensionAdjuster;

impl DimensionAdjuster {
    /// The size whose sides are both multiples of `split_len`.
    ///
    /// The nearest multiple is chosen; a tie is rounded **down** (`365` at a split length of `10`
    /// becomes `360`, not `370`), and a side is never rounded to zero — a four-pixel-wide image is
    /// grown to one cell rather than collapsed.
    ///
    /// # Errors
    ///
    /// Returns [`DimensionsError::TooLarge`] when rounding up pushes a side past
    /// [`MAX_SIDE`](crate::domain::dimensions::MAX_SIDE).
    pub fn adjust_to_multiple(
        dimensions: Dimensions,
        split_len: u32,
    ) -> Result<Dimensions, DimensionsError> {
        Dimensions::new(
            Self::adjust_side(dimensions.width(), split_len),
            Self::adjust_side(dimensions.height(), split_len),
        )
    }

    /// Rounds one side to the nearest non-zero multiple of `split_len`.
    ///
    /// A split length of zero is not a size the engine can produce — the accepted range is 5 to
    /// 100 — so it is passed through unchanged rather than dividing by zero. That keeps this
    /// function total, and [`VideoConfig`](crate::domain::VideoConfig) is what refuses the value.
    #[must_use]
    pub const fn adjust_side(value: u32, split_len: u32) -> u32 {
        if split_len == 0 {
            return value;
        }

        let remainder = value % split_len;
        if remainder == 0 {
            return value;
        }

        let lower = value - remainder;
        let upper = lower + split_len;

        // A side smaller than one cell is grown to one cell rather than rounded away.
        if lower < split_len {
            return upper;
        }

        if remainder <= split_len - remainder {
            lower
        } else {
            upper
        }
    }
}

#[cfg(test)]
mod tests {
    use super::DimensionAdjuster;
    use crate::domain::Dimensions;

    #[test]
    fn a_size_that_already_fits_is_left_alone() {
        assert_eq!(DimensionAdjuster::adjust_side(360, 10), 360);
        assert_eq!(DimensionAdjuster::adjust_side(490, 10), 490);
        assert_eq!(
            DimensionAdjuster::adjust_to_multiple(Dimensions::new(360, 490).unwrap(), 10).unwrap(),
            Dimensions::new(360, 490).unwrap()
        );
    }

    #[test]
    fn rounds_to_the_nearest_multiple() {
        assert_eq!(DimensionAdjuster::adjust_side(364, 10), 360);
        assert_eq!(DimensionAdjuster::adjust_side(366, 10), 370);
        assert_eq!(DimensionAdjuster::adjust_side(390, 100), 400);
        assert_eq!(DimensionAdjuster::adjust_side(320, 100), 300);
    }

    #[test]
    fn a_tie_rounds_down() {
        assert_eq!(DimensionAdjuster::adjust_side(365, 10), 360);
        assert_eq!(DimensionAdjuster::adjust_side(250, 100), 200);
    }

    #[test]
    fn a_tiny_side_grows_to_one_cell_instead_of_vanishing() {
        assert_eq!(DimensionAdjuster::adjust_side(4, 10), 10);
        assert_eq!(DimensionAdjuster::adjust_side(9, 10), 10);
        assert_eq!(
            DimensionAdjuster::adjust_to_multiple(Dimensions::new(4, 4).unwrap(), 10).unwrap(),
            Dimensions::new(10, 10).unwrap()
        );
    }

    #[test]
    fn a_split_length_of_zero_leaves_the_size_alone() {
        assert_eq!(DimensionAdjuster::adjust_side(123, 0), 123);
    }

    #[test]
    fn rounding_up_past_the_limit_is_refused_rather_than_clamped() {
        let huge = Dimensions::new(16_384, 100).unwrap();
        assert!(DimensionAdjuster::adjust_to_multiple(huge, 100).is_err());
    }
}
