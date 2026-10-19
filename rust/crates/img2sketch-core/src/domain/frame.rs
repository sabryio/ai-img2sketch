//! A drawing surface in memory.

use super::dimensions::{Dimensions, DimensionsError};

/// The number of bytes one pixel takes.
const CHANNELS: usize = 3;

/// A decoded image: RGB8, row-major, no padding between rows.
///
/// This is the currency of the engine — the preprocessor produces one, the drawing loop paints
/// into one, the encoder is fed one. The channel order is RGB rather than OpenCV's BGR because
/// nothing in this crate should carry one library's convention; the adapter that talks to a
/// library converts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    dimensions: Dimensions,
    rgb: Vec<u8>,
}

/// Why a frame could not be built.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum FrameError {
    /// The pixel buffer did not match the size it was given for.
    #[error("expected {expected} bytes of RGB for {width}x{height}, got {actual}")]
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

impl Frame {
    /// Wraps a pixel buffer, checking it matches the size exactly.
    ///
    /// # Errors
    ///
    /// Returns [`FrameError::WrongLength`] if `rgb` is not exactly `width * height * 3` bytes
    /// long.
    pub fn new(dimensions: Dimensions, rgb: Vec<u8>) -> Result<Self, FrameError> {
        let expected = (dimensions.pixel_count() as usize) * CHANNELS;
        if rgb.len() != expected {
            return Err(FrameError::WrongLength {
                expected,
                actual: rgb.len(),
                width: dimensions.width(),
                height: dimensions.height(),
            });
        }
        Ok(Self { dimensions, rgb })
    }

    /// Fills a frame with one colour.
    #[must_use]
    pub fn filled(dimensions: Dimensions, rgb: [u8; CHANNELS]) -> Self {
        let mut buffer = Vec::with_capacity((dimensions.pixel_count() as usize) * CHANNELS);
        for _ in 0..dimensions.pixel_count() {
            buffer.extend_from_slice(&rgb);
        }
        // The length is derived from the dimensions, so this cannot fail.
        Self::new(dimensions, buffer).unwrap_or_else(|error| unreachable!("{error}"))
    }

    /// The frame's size.
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

    /// The pixels, RGB8, `width * height * 3` bytes.
    #[must_use]
    pub fn rgb(&self) -> &[u8] {
        &self.rgb
    }

    /// The pixels, mutably.
    ///
    /// The slice is the whole buffer, so a caller cannot resize the frame out of step with its
    /// dimensions.
    #[must_use]
    pub fn rgb_mut(&mut self) -> &mut [u8] {
        &mut self.rgb
    }

    /// The pixels, consumed.
    #[must_use]
    pub fn into_rgb(self) -> Vec<u8> {
        self.rgb
    }

    /// Copies the last row and column into new ones until both sides are even.
    ///
    /// The encoder's pixel format cannot hold an odd side, and the replicated line is what the
    /// Python writer produces — a black pad would show as a stripe.
    #[must_use]
    pub fn padded_to_even(&self) -> Self {
        if self.dimensions.is_even() {
            return self.clone();
        }

        let target = self.dimensions.even_for_encoder();
        let (source_width, source_height) = (
            self.dimensions.width() as usize,
            self.dimensions.height() as usize,
        );
        let (target_width, target_height) = (target.width() as usize, target.height() as usize);

        let mut buffer = Vec::with_capacity(target_width * target_height * CHANNELS);
        for y in 0..target_height {
            let source_y = y.min(source_height - 1);
            for x in 0..target_width {
                let source_x = x.min(source_width - 1);
                let offset = (source_y * source_width + source_x) * CHANNELS;
                buffer.extend_from_slice(&self.rgb[offset..offset + CHANNELS]);
            }
        }

        // The buffer was built to the target dimensions, so this cannot fail.
        Self::new(target, buffer).unwrap_or_else(|error| unreachable!("{error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{Frame, FrameError};
    use crate::domain::Dimensions;

    /// A 3x3 frame whose pixels are `(x, y, 0)` — easy to verify a pad against.
    fn three_by_three() -> Frame {
        let mut rgb = Vec::new();
        for y in 0..3u8 {
            for x in 0..3u8 {
                rgb.extend_from_slice(&[x, y, 0]);
            }
        }
        Frame::new(Dimensions::new(3, 3).unwrap(), rgb).unwrap()
    }

    #[test]
    fn refuses_a_buffer_that_does_not_fit_the_size() {
        let error = Frame::new(Dimensions::new(2, 2).unwrap(), vec![0; 11]).unwrap_err();
        assert_eq!(
            error,
            FrameError::WrongLength {
                expected: 12,
                actual: 11,
                width: 2,
                height: 2
            }
        );
    }

    #[test]
    fn leaves_an_even_frame_alone() {
        let frame = Frame::filled(Dimensions::new(4, 2).unwrap(), [1, 2, 3]);
        assert_eq!(frame.padded_to_even(), frame);
    }

    #[test]
    fn pads_an_odd_frame_by_replicating_its_last_line() {
        let padded = three_by_three().padded_to_even();
        assert_eq!(padded.dimensions(), Dimensions::new(4, 4).unwrap());
        assert_eq!(padded.rgb().len(), 4 * 4 * 3);

        // The new right-hand column is a copy of column 2, and the new bottom row a copy of row 2.
        let pixel = |frame: &Frame, x: usize, y: usize| {
            let offset = (y * frame.width() as usize + x) * 3;
            frame.rgb()[offset..offset + 3].to_vec()
        };
        assert_eq!(pixel(&padded, 3, 0), pixel(&padded, 2, 0));
        assert_eq!(pixel(&padded, 0, 3), pixel(&padded, 0, 2));
        assert_eq!(pixel(&padded, 3, 3), pixel(&padded, 2, 2));
        assert_eq!(pixel(&padded, 0, 0), vec![0, 0, 0]);
    }

    #[test]
    fn mutable_pixels_stay_the_same_length() {
        let mut frame = Frame::filled(Dimensions::new(2, 2).unwrap(), [0, 0, 0]);
        frame.rgb_mut()[0] = 255;
        assert_eq!(frame.rgb()[0], 255);
        assert_eq!(frame.rgb().len(), 12);
    }
}
