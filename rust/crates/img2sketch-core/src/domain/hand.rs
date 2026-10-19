//! The drawing hand that is composited over each frame.
//!
//! The hand is an image and a mask, and both are needed: the image supplies the pixels, the mask
//! says which of them replace what is underneath. They are cropped together to the mask's bounds
//! when loaded, so a mostly-empty PNG does not carry a border of transparent pixels around with
//! it into every frame.
//!
//! [`inverse_mask`](Hand::inverse_mask) is stored as a fraction rather than a byte because that is
//! what the blend is: `frame * (1 - mask) + hand`. Keeping it a float is not an aesthetic choice —
//! a `u8` multiply in the Python engine saturates, and a fractional multiply does not.

use super::dimensions::Dimensions;
use super::frame::Frame;

/// A drawing hand, cropped to its visible pixels.
#[derive(Debug, Clone, PartialEq)]
pub struct Hand {
    image: Frame,
    inverse_mask: Vec<f64>,
}

/// Why a hand could not be built.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum HandError {
    /// The mask did not cover the same pixels as the image.
    #[error("the hand mask has {actual} values for a {expected}-pixel hand")]
    WrongMaskLength {
        /// Values the hand's size calls for.
        expected: usize,
        /// Values supplied.
        actual: usize,
    },
    /// A mask value was not a fraction between 0 and 1.
    #[error("a hand mask value of {0} is outside the 0..1 range")]
    MaskOutOfRange(f64),
}

impl Hand {
    /// Pairs a hand image with its inverse mask.
    ///
    /// # Errors
    ///
    /// Returns [`HandError::WrongMaskLength`] if the mask does not cover the image pixel for pixel,
    /// and [`HandError::MaskOutOfRange`] if a value is not in `0..=1`.
    pub fn new(image: Frame, inverse_mask: Vec<f64>) -> Result<Self, HandError> {
        let expected = image.dimensions().pixel_count() as usize;
        if inverse_mask.len() != expected {
            return Err(HandError::WrongMaskLength {
                expected,
                actual: inverse_mask.len(),
            });
        }
        if let Some(value) = inverse_mask
            .iter()
            .copied()
            .find(|value| !(0.0..=1.0).contains(value))
        {
            return Err(HandError::MaskOutOfRange(value));
        }
        Ok(Self {
            image,
            inverse_mask,
        })
    }

    /// The hand's size.
    #[must_use]
    pub const fn dimensions(&self) -> Dimensions {
        self.image.dimensions()
    }

    /// The hand's pixels, RGB8.
    #[must_use]
    pub fn image(&self) -> &Frame {
        &self.image
    }

    /// How much of the frame shows through at each pixel: `1.0` shows the frame, `0.0` shows only
    /// the hand.
    #[must_use]
    pub fn inverse_mask(&self) -> &[f64] {
        &self.inverse_mask
    }

    /// The mask value at a pixel, or `None` when it is outside the hand.
    #[must_use]
    pub fn inverse_mask_at(&self, x: u32, y: u32) -> Option<f64> {
        if x >= self.dimensions().width() || y >= self.dimensions().height() {
            return None;
        }
        let index = (y as usize) * (self.dimensions().width() as usize) + (x as usize);
        self.inverse_mask.get(index).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::{Hand, HandError};
    use crate::domain::{Dimensions, Frame};

    fn two_by_two() -> Frame {
        Frame::filled(Dimensions::new(2, 2).unwrap(), [1, 2, 3])
    }

    #[test]
    fn pairs_an_image_with_a_mask() {
        let hand = Hand::new(two_by_two(), vec![0.0, 0.5, 1.0, 1.0]).unwrap();
        assert_eq!(hand.dimensions(), Dimensions::new(2, 2).unwrap());
        assert_eq!(hand.inverse_mask_at(1, 0), Some(0.5));
        assert_eq!(hand.inverse_mask_at(0, 1), Some(1.0));
    }

    #[test]
    fn refuses_a_mask_that_does_not_cover_the_hand() {
        let error = Hand::new(two_by_two(), vec![1.0]).unwrap_err();
        assert_eq!(
            error,
            HandError::WrongMaskLength {
                expected: 4,
                actual: 1
            }
        );
    }

    #[test]
    fn refuses_a_mask_value_that_is_not_a_fraction() {
        let error = Hand::new(two_by_two(), vec![1.0, 1.0, 1.5, 1.0]).unwrap_err();
        assert_eq!(error, HandError::MaskOutOfRange(1.5));
    }

    #[test]
    fn a_pixel_outside_the_hand_has_no_mask() {
        let hand = Hand::new(two_by_two(), vec![1.0; 4]).unwrap();
        assert_eq!(hand.inverse_mask_at(2, 0), None);
    }
}
