//! A single-channel image.
//!
//! The drawing needs one channel and one channel only: the thresholded image, where a pixel is
//! either ink or paper. Carrying that as a three-channel frame would triple the memory and invite
//! the question of which channel is authoritative. It is an image rather than a `Vec<u8>` because
//! the drawing constantly asks for a *cell* of it, and that question needs the width.

use super::dimensions::{Dimensions, DimensionsError};

/// A decoded single-channel image, row-major, one byte per pixel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrayImage {
    dimensions: Dimensions,
    pixels: Vec<u8>,
}

/// Why a single-channel image could not be built.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GrayImageError {
    /// The pixel buffer did not match the size it was given for.
    #[error("expected {expected} bytes of grey for {width}x{height}, got {actual}")]
    WrongLength {
        /// Bytes the dimensions call for.
        expected: usize,
        /// Bytes supplied.
        actual: usize,
        /// The width the buffer was meant to fill.
        width: u32,
        /// The height the buffer was meant to fill.
        height: u32,
    },
    /// The size itself was invalid.
    #[error(transparent)]
    Dimensions(#[from] DimensionsError),
}

impl GrayImage {
    /// Wraps a pixel buffer, checking it matches the size exactly.
    ///
    /// # Errors
    ///
    /// Returns [`GrayImageError::WrongLength`] if `pixels` is not exactly `width * height` bytes.
    pub fn new(dimensions: Dimensions, pixels: Vec<u8>) -> Result<Self, GrayImageError> {
        let expected = dimensions.pixel_count() as usize;
        if pixels.len() != expected {
            return Err(GrayImageError::WrongLength {
                expected,
                actual: pixels.len(),
                width: dimensions.width(),
                height: dimensions.height(),
            });
        }
        Ok(Self { dimensions, pixels })
    }

    /// Fills an image with one value.
    #[must_use]
    pub fn filled(dimensions: Dimensions, value: u8) -> Self {
        Self {
            dimensions,
            pixels: vec![value; dimensions.pixel_count() as usize],
        }
    }

    /// The image's size.
    #[must_use]
    pub const fn dimensions(&self) -> Dimensions {
        self.dimensions
    }

    /// The width in pixels.
    #[must_use]
    pub const fn width(&self) -> u32 {
        self.dimensions.width()
    }

    /// The height in pixels.
    #[must_use]
    pub const fn height(&self) -> u32 {
        self.dimensions.height()
    }

    /// The pixels, row-major, one byte each.
    #[must_use]
    pub fn pixels(&self) -> &[u8] {
        &self.pixels
    }

    /// The pixels, mutably.
    #[must_use]
    pub fn pixels_mut(&mut self) -> &mut [u8] {
        &mut self.pixels
    }

    /// The value at a pixel, or `None` when it is outside the image.
    #[must_use]
    pub fn pixel(&self, x: u32, y: u32) -> Option<u8> {
        if x >= self.width() || y >= self.height() {
            return None;
        }
        let index = (y as usize) * (self.width() as usize) + (x as usize);
        self.pixels.get(index).copied()
    }

    /// The pixels, consumed.
    #[must_use]
    pub fn into_pixels(self) -> Vec<u8> {
        self.pixels
    }
}

#[cfg(test)]
mod tests {
    use super::{GrayImage, GrayImageError};
    use crate::domain::Dimensions;

    #[test]
    fn refuses_a_buffer_that_does_not_fit_the_size() {
        let error = GrayImage::new(Dimensions::new(2, 2).unwrap(), vec![0; 3]).unwrap_err();
        assert_eq!(
            error,
            GrayImageError::WrongLength {
                expected: 4,
                actual: 3,
                width: 2,
                height: 2
            }
        );
    }

    #[test]
    fn fills_and_reads_back() {
        let mut image = GrayImage::filled(Dimensions::new(3, 2).unwrap(), 7);
        assert_eq!(image.pixels().len(), 6);
        assert_eq!(image.pixel(0, 0), Some(7));
        assert_eq!(image.pixel(2, 1), Some(7));

        image.pixels_mut()[4] = 200;
        assert_eq!(image.pixel(1, 1), Some(200));
    }

    #[test]
    fn a_pixel_outside_the_image_is_none_rather_than_a_panic() {
        let image = GrayImage::filled(Dimensions::new(2, 2).unwrap(), 0);
        assert_eq!(image.pixel(2, 0), None);
        assert_eq!(image.pixel(0, 2), None);
    }
}
