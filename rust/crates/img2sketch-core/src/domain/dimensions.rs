//! Canvas size, and the even-size rule the encoder needs.

use serde::{Deserialize, Serialize};

/// The longest side the engine will accept.
///
/// A canvas is allocated in full before any drawing happens, so a request for something
/// enormous has to be refused rather than attempted.
pub const MAX_SIDE: u32 = 16_384;

/// A non-zero pixel size.
///
/// Constructing one is the only way to obtain one, so the rest of the engine never has to ask
/// whether a width is zero — a `Dimensions` is valid by definition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Dimensions {
    width: u32,
    height: u32,
}

/// Why a size was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DimensionsError {
    /// A side was zero.
    #[error("a canvas needs a non-zero width and height (got {width}x{height})")]
    Zero {
        /// The width that was asked for.
        width: u32,
        /// The height that was asked for.
        height: u32,
    },
    /// A side exceeded [`MAX_SIDE`].
    #[error("a side of {0}px exceeds the maximum of {MAX_SIDE}px")]
    TooLarge(u32),
}

impl Dimensions {
    /// Creates a size, refusing anything the engine cannot render.
    ///
    /// # Errors
    ///
    /// Returns [`DimensionsError::Zero`] when either side is zero, and
    /// [`DimensionsError::TooLarge`] when either side exceeds [`MAX_SIDE`].
    pub fn new(width: u32, height: u32) -> Result<Self, DimensionsError> {
        if width == 0 || height == 0 {
            return Err(DimensionsError::Zero { width, height });
        }
        if width > MAX_SIDE {
            return Err(DimensionsError::TooLarge(width));
        }
        if height > MAX_SIDE {
            return Err(DimensionsError::TooLarge(height));
        }
        Ok(Self { width, height })
    }

    /// The width in pixels.
    #[must_use]
    pub const fn width(&self) -> u32 {
        self.width
    }

    /// The height in pixels.
    #[must_use]
    pub const fn height(&self) -> u32 {
        self.height
    }

    /// How many pixels the canvas holds, as 64 bits — `width * height` overflows a `u32` once
    /// both sides are large.
    #[must_use]
    pub const fn pixel_count(&self) -> u64 {
        self.width as u64 * self.height as u64
    }

    /// Whether both sides are already even.
    #[must_use]
    pub const fn is_even(&self) -> bool {
        self.width.is_multiple_of(2) && self.height.is_multiple_of(2)
    }

    /// The smallest even-sided size that is at least this big.
    ///
    /// `yuv420p` keeps chroma at half resolution, so an odd side has nowhere to put its last
    /// column or row. The writer grows the canvas before encoding; parity requires the same
    /// growth here, and the extra line is a copy of its neighbour (see
    /// [`Frame::padded_to_even`](crate::domain::Frame::padded_to_even)).
    #[must_use]
    pub const fn even_for_encoder(self) -> Self {
        Self {
            width: self.width + (self.width % 2),
            height: self.height + (self.height % 2),
        }
    }

    /// Width divided by height, for display.
    #[must_use]
    pub fn aspect_ratio(&self) -> f64 {
        f64::from(self.width) / f64::from(self.height)
    }

    /// The numbers that divide both this size's sides and another's.
    ///
    /// Used to suggest a grid split length that fits an image exactly. The Python value object
    /// compares the *smaller* of each pair of sides, and this is a port rather than an
    /// improvement — a different answer here would change the advice the interface gives.
    #[must_use]
    pub fn find_common_divisors(&self, other: &Self) -> Vec<u32> {
        let width_divisors = divisors(self.width.min(other.width));
        let height_divisors = divisors(self.height.min(other.height));
        let mut common: Vec<u32> = width_divisors
            .into_iter()
            .filter(|divisor| height_divisors.contains(divisor))
            .collect();
        common.sort_unstable();
        common.dedup();
        common
    }
}

/// Every number that divides `value` exactly, ascending.
fn divisors(value: u32) -> Vec<u32> {
    (1..=value)
        .filter(|divisor| value.is_multiple_of(*divisor))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{Dimensions, DimensionsError, MAX_SIDE};

    #[test]
    fn accepts_a_normal_canvas() {
        let dimensions = Dimensions::new(1920, 1080).unwrap();
        assert_eq!(dimensions.width(), 1920);
        assert_eq!(dimensions.height(), 1080);
        assert_eq!(dimensions.pixel_count(), 2_073_600);
    }

    #[test]
    fn refuses_a_zero_side() {
        assert_eq!(
            Dimensions::new(0, 10),
            Err(DimensionsError::Zero {
                width: 0,
                height: 10
            })
        );
        assert_eq!(
            Dimensions::new(10, 0),
            Err(DimensionsError::Zero {
                width: 10,
                height: 0
            })
        );
    }

    #[test]
    fn refuses_a_side_past_the_limit() {
        assert_eq!(
            Dimensions::new(MAX_SIDE + 1, 10),
            Err(DimensionsError::TooLarge(MAX_SIDE + 1))
        );
        assert!(Dimensions::new(MAX_SIDE, MAX_SIDE).is_ok());
        assert_eq!(
            Dimensions::new(MAX_SIDE, MAX_SIDE).unwrap().pixel_count(),
            268_435_456
        );
    }

    #[test]
    fn grows_only_the_odd_sides() {
        assert_eq!(
            Dimensions::new(3, 5).unwrap().even_for_encoder(),
            Dimensions::new(4, 6).unwrap()
        );
        assert_eq!(
            Dimensions::new(4, 4).unwrap().even_for_encoder(),
            Dimensions::new(4, 4).unwrap()
        );
        assert_eq!(
            Dimensions::new(3, 4).unwrap().even_for_encoder(),
            Dimensions::new(4, 4).unwrap()
        );
        assert!(!Dimensions::new(7, 9).unwrap().is_even());
        assert!(Dimensions::new(7, 9).unwrap().even_for_encoder().is_even());
    }

    #[test]
    fn serialises_as_the_api_spells_it() {
        let json = serde_json::to_string(&Dimensions::new(360, 490).unwrap()).unwrap();
        assert_eq!(json, r#"{"width":360,"height":490}"#);
    }

    #[test]
    fn reports_the_aspect_ratio() {
        assert!(
            (Dimensions::new(1920, 1080).unwrap().aspect_ratio() - 1.777_777_777_777_778).abs()
                < 1e-12
        );
        assert_eq!(Dimensions::new(100, 200).unwrap().aspect_ratio(), 0.5);
    }

    #[test]
    fn finds_the_numbers_that_divide_both_sizes() {
        let left = Dimensions::new(360, 490).unwrap();
        // 360 and 490 share 1, 2, 5 and 10.
        assert_eq!(left.find_common_divisors(&left), vec![1, 2, 5, 10]);
        let right = Dimensions::new(120, 80).unwrap();
        let common = left.find_common_divisors(&right);
        assert!(common.contains(&10));
        assert!(common.contains(&1));
        assert!(
            common.windows(2).all(|pair| pair[0] < pair[1]),
            "ascending and unique"
        );
    }
}
