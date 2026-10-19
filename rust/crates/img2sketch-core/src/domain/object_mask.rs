//! Naming parts of an image, so they can be drawn in a chosen order and at a chosen speed.
//!
//! Without masks the whole drawing is one pass. With them, the subject can be drawn first and the
//! background last, each at its own skip rate — which is what makes "draw the face, then the sky"
//! expressible. The order of the list *is* the order of the drawing; there is no sorting knob,
//! because the file the user wrote already means something.
//!
//! A mask with no region is the catch-all: it owns every pixel no other mask claimed. There can be
//! one, and it is the only way to say "and then everything else".

use super::dimensions::Dimensions;

/// Which pixels of the target canvas belong to one object.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Region {
    dimensions: Dimensions,
    pixels: Vec<bool>,
}

/// Why a region could not be built.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RegionError {
    /// The raster did not cover the canvas it was given for.
    #[error("expected {expected} mask values for {width}x{height}, got {actual}")]
    WrongLength {
        /// Values the dimensions call for.
        expected: usize,
        /// Values supplied.
        actual: usize,
        /// The width the raster was meant to fill.
        width: u32,
        /// The height the raster was meant to fill.
        height: u32,
    },
}

impl Region {
    /// Wraps a per-pixel raster for one canvas size.
    ///
    /// # Errors
    ///
    /// Returns [`RegionError::WrongLength`] when the raster does not cover the canvas exactly.
    pub fn new(dimensions: Dimensions, pixels: Vec<bool>) -> Result<Self, RegionError> {
        let expected = dimensions.pixel_count() as usize;
        if pixels.len() != expected {
            return Err(RegionError::WrongLength {
                expected,
                actual: pixels.len(),
                width: dimensions.width(),
                height: dimensions.height(),
            });
        }
        Ok(Self { dimensions, pixels })
    }

    /// The canvas the raster describes.
    #[must_use]
    pub const fn dimensions(&self) -> Dimensions {
        self.dimensions
    }

    /// The raster, row-major.
    #[must_use]
    pub fn pixels(&self) -> &[bool] {
        &self.pixels
    }

    /// Whether a pixel belongs to this object.
    #[must_use]
    pub fn contains(&self, x: u32, y: u32) -> bool {
        if x >= self.dimensions.width() || y >= self.dimensions.height() {
            return false;
        }
        let index = (y as usize) * (self.dimensions.width() as usize) + (x as usize);
        self.pixels.get(index).copied().unwrap_or(false)
    }
}

/// One named object: a region, or the catch-all, plus an optional drawing speed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectMask {
    name: String,
    region: Option<Region>,
    skip_rate: Option<u32>,
}

/// Why an object mask could not be built.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ObjectMaskError {
    /// An object needs a name to be reported by.
    #[error("an object mask needs a non-empty name")]
    EmptyName,
    /// A skip rate of zero would mean "write a frame every no cells".
    #[error("an object mask's skip rate must be at least 1")]
    ZeroSkipRate,
}

impl ObjectMask {
    /// Names a region, optionally drawn at its own skip rate.
    ///
    /// # Errors
    ///
    /// Returns [`ObjectMaskError::EmptyName`] for a blank name, and
    /// [`ObjectMaskError::ZeroSkipRate`] for a skip rate of zero.
    pub fn new(
        name: impl Into<String>,
        region: Option<Region>,
        skip_rate: Option<u32>,
    ) -> Result<Self, ObjectMaskError> {
        let name = name.into();
        if name.trim().is_empty() {
            return Err(ObjectMaskError::EmptyName);
        }
        if skip_rate == Some(0) {
            return Err(ObjectMaskError::ZeroSkipRate);
        }
        Ok(Self {
            name,
            region,
            skip_rate,
        })
    }

    /// Names the catch-all object: everything no other mask claimed.
    ///
    /// # Errors
    ///
    /// Returns [`ObjectMaskError::EmptyName`] for a blank name, and
    /// [`ObjectMaskError::ZeroSkipRate`] for a skip rate of zero.
    pub fn background(
        name: impl Into<String>,
        skip_rate: Option<u32>,
    ) -> Result<Self, ObjectMaskError> {
        Self::new(name, None, skip_rate)
    }

    /// What the object is called, for a status line.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The pixels the object owns, or `None` when it is the catch-all.
    #[must_use]
    pub const fn region(&self) -> Option<&Region> {
        self.region.as_ref()
    }

    /// The object's own drawing speed, when it has one.
    #[must_use]
    pub const fn skip_rate(&self) -> Option<u32> {
        self.skip_rate
    }
}

#[cfg(test)]
mod tests {
    use super::{ObjectMask, ObjectMaskError, Region, RegionError};
    use crate::domain::Dimensions;

    #[test]
    fn a_region_must_cover_the_canvas() {
        let dimensions = Dimensions::new(2, 2).unwrap();
        assert_eq!(
            Region::new(dimensions, vec![true; 3]),
            Err(RegionError::WrongLength {
                expected: 4,
                actual: 3,
                width: 2,
                height: 2
            })
        );
        let region = Region::new(dimensions, vec![true, false, false, true]).unwrap();
        assert!(region.contains(0, 0));
        assert!(!region.contains(1, 0));
        assert!(!region.contains(2, 2), "outside the canvas is nobody's");
    }

    #[test]
    fn a_mask_needs_a_name_and_a_speed_above_zero() {
        assert_eq!(
            ObjectMask::new("  ", None, None).unwrap_err(),
            ObjectMaskError::EmptyName
        );
        assert_eq!(
            ObjectMask::new("face", None, Some(0)).unwrap_err(),
            ObjectMaskError::ZeroSkipRate
        );
    }

    #[test]
    fn a_background_mask_has_no_region() {
        let mask = ObjectMask::background("background", None).unwrap();
        assert!(mask.region().is_none());
        assert_eq!(mask.name(), "background");
        assert_eq!(mask.skip_rate(), None);
    }
}
