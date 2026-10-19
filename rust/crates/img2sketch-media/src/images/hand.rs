//! Loading the drawing hand.
//!
//! Two providers, one shape: the hand that ships inside the binary and the hand a user points at
//! with `--hand-image`. Both end up in the same pipeline — decode, crop to the mask, invert the
//! mask, zero the invisible part of the image — because the drawing should not be able to tell
//! where its hand came from.
//!
//! Four details are ports of `infrastructure/image_processing/hand_loader.py`, and each of them
//! changes the pixels if it is done the obvious way instead:
//!
//! - **Crop to the mask's bounds**, not to the image's. The bundled hand PNG is mostly empty
//!   around the fingers, and cropping it means the overlay's "crop to what fits" arithmetic starts
//!   from the same corner in both engines.
//! - **The mask is inverted as a fraction**: `1.0 - mask / 255.0`, not `255 - mask`. The overlay
//!   multiplies by it.
//! - **The hand image is zeroed where the mask is zero**, before anything else touches it. That is
//!   what makes a transparent mask leave the frame alone even though the overlay adds the hand's
//!   pixel unconditionally.
//! - **The alpha channel is dropped, not composited.** `cv2.imread` in colour mode ignores alpha
//!   and so does this; an RGBA hand PNG would otherwise arrive pre-multiplied against a colour the
//!   Python engine never sees.
//!
//! The bundled assets live in `resources/` beside this crate and are copied from
//! `src/ai_img2sketch/resources/images/`, byte for byte, so the two engines draw the same hand.

use std::path::PathBuf;

use img2sketch_core::application::ports::{HandLoadError, HandProvider};
use img2sketch_core::domain::{Dimensions, Frame, Hand};

/// The bundled hand image, as shipped.
pub const BUNDLED_HAND_IMAGE: &[u8] = include_bytes!("../../resources/drawing-hand.png");

/// The bundled hand mask, as shipped.
pub const BUNDLED_HAND_MASK: &[u8] = include_bytes!("../../resources/hand-mask.png");

/// Where one half of a hand comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandAsset {
    /// The copy compiled into the binary.
    Bundled,
    /// A file the user chose.
    File(PathBuf),
}

impl HandAsset {
    /// The asset's bytes, reading the file when there is one.
    fn bytes(&self, bundled: &'static [u8]) -> Result<Vec<u8>, HandLoadError> {
        match self {
            Self::Bundled => Ok(bundled.to_vec()),
            Self::File(path) => std::fs::read(path)
                .map_err(|error| HandLoadError::Unreadable(format!("{}: {error}", path.display()))),
        }
    }
}

/// The drawing hand, assembled from an image and a mask that may each be bundled or a file.
///
/// Two assets rather than one "is the hand custom" flag, because they are chosen separately: the
/// Python CLI falls back to the bundled asset per half, so `--hand-image mine.png` with the shipped
/// mask is a run it accepts. Refusing that here would be a difference nobody asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandSource {
    image: HandAsset,
    mask: HandAsset,
}

impl HandSource {
    /// Pairs an image source with a mask source.
    #[must_use]
    pub fn new(image: HandAsset, mask: HandAsset) -> Self {
        Self { image, mask }
    }

    /// The hand the app ships with.
    #[must_use]
    pub fn bundled() -> Self {
        Self::new(HandAsset::Bundled, HandAsset::Bundled)
    }

    /// Files for whichever half was chosen, the bundled asset for the rest.
    #[must_use]
    pub fn from_files(image: Option<PathBuf>, mask: Option<PathBuf>) -> Self {
        Self::new(
            image.map_or(HandAsset::Bundled, HandAsset::File),
            mask.map_or(HandAsset::Bundled, HandAsset::File),
        )
    }
}

impl Default for HandSource {
    fn default() -> Self {
        Self::bundled()
    }
}

impl HandProvider for HandSource {
    fn load(&self) -> Result<Hand, HandLoadError> {
        let image = self.image.bytes(BUNDLED_HAND_IMAGE)?;
        let mask = self.mask.bytes(BUNDLED_HAND_MASK)?;
        decode_hand(&image, &mask)
    }
}

/// Decodes a hand image and mask, cropped to the mask's foreground.
///
/// # Errors
///
/// Returns [`HandLoadError::Unreadable`] when either PNG cannot be decoded or the mask has no
/// foreground pixels, and [`HandLoadError::Invalid`] when the cropped pair does not form a hand.
pub fn decode_hand(image_bytes: &[u8], mask_bytes: &[u8]) -> Result<Hand, HandLoadError> {
    let image = image::load_from_memory(image_bytes)
        .map_err(|error| HandLoadError::Unreadable(format!("the hand image: {error}")))?
        .to_rgb8();
    let mask = image::load_from_memory(mask_bytes)
        .map_err(|error| HandLoadError::Unreadable(format!("the hand mask: {error}")))?
        .to_luma8();

    let bounds = mask_bounds(&mask).ok_or_else(|| {
        HandLoadError::Unreadable("the hand mask has no foreground pixels".to_string())
    })?;

    let width = bounds.right - bounds.left;
    let height = bounds.bottom - bounds.top;
    let mut rgb = Vec::with_capacity((width * height * 3) as usize);
    let mut inverse_mask = Vec::with_capacity((width * height) as usize);

    for y in bounds.top..bounds.bottom {
        for x in bounds.left..bounds.right {
            let mask_value = mask.get_pixel(x, y)[0];
            inverse_mask.push(1.0 - f64::from(mask_value) / 255.0);

            let pixel = image.get_pixel(x, y);
            if mask_value == 0 {
                rgb.extend_from_slice(&[0, 0, 0]);
            } else {
                rgb.extend_from_slice(&[pixel[0], pixel[1], pixel[2]]);
            }
        }
    }

    let dimensions = Dimensions::new(width, height)?;
    let image = Frame::new(dimensions, rgb)?;
    Ok(Hand::new(image, inverse_mask)?)
}

/// The smallest rectangle containing every fully-opaque mask pixel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Bounds {
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
}

/// The bounds of the mask's `255` pixels, or `None` when there are none.
fn mask_bounds(mask: &image::GrayImage) -> Option<Bounds> {
    let mut bounds: Option<Bounds> = None;
    for (x, y, pixel) in mask.enumerate_pixels() {
        if pixel[0] != 255 {
            continue;
        }
        bounds = Some(match bounds {
            None => Bounds {
                left: x,
                top: y,
                right: x + 1,
                bottom: y + 1,
            },
            Some(current) => Bounds {
                left: current.left.min(x),
                top: current.top.min(y),
                right: current.right.max(x + 1),
                bottom: current.bottom.max(y + 1),
            },
        });
    }
    bounds
}

#[cfg(test)]
mod tests {
    use super::{BUNDLED_HAND_IMAGE, BUNDLED_HAND_MASK, HandAsset, HandSource, decode_hand};
    use img2sketch_core::application::ports::HandProvider;
    use std::path::PathBuf;

    #[test]
    fn the_bundled_hand_loads_and_is_cropped_to_its_foreground() {
        use img2sketch_core::domain::Dimensions;

        let hand = HandSource::bundled().load().unwrap();

        // The shipped assets are 361x493 with the fingers bounded by `[14, 32)..[482, 317)`, so the
        // hand the drawing gets is 285x468. Pinned, because a change here silently moves every
        // hand in every frame — and because it is the check that the crop matches the Python
        // loader, which crops to the same rectangle.
        assert_eq!(hand.dimensions(), Dimensions::new(285, 468).unwrap());
        assert_eq!(
            hand.inverse_mask().len(),
            hand.dimensions().pixel_count() as usize
        );
        assert!(
            hand.inverse_mask()
                .iter()
                .all(|value| (0.0..=1.0).contains(value)),
            "every mask value is a fraction"
        );
        assert!(
            hand.inverse_mask().contains(&0.0),
            "some of the hand is opaque"
        );
    }

    #[test]
    fn a_fully_transparent_hand_pixel_is_black() {
        // The zeroing step: wherever the mask is empty, the hand contributes nothing to add.
        let hand = HandSource::bundled().load().unwrap();
        let width = hand.dimensions().width() as usize;
        for (index, alpha) in hand.inverse_mask().iter().enumerate() {
            if *alpha == 1.0 {
                let pixel = &hand.image().rgb()[index * 3..index * 3 + 3];
                assert_eq!(pixel, [0, 0, 0], "pixel {index} at x={}", index % width);
            }
        }
    }

    #[test]
    fn a_mask_with_no_foreground_is_refused() {
        assert!(decode_hand(BUNDLED_HAND_IMAGE, BUNDLED_HAND_MASK).is_ok());

        // A two-by-two all-black mask: decodable, but with nothing to crop to.
        let black = grey_png(&[0, 0, 0, 0], 2, 2);
        let error = decode_hand(BUNDLED_HAND_IMAGE, &black).unwrap_err();
        assert!(
            error.to_string().contains("no foreground pixels"),
            "got: {error}"
        );
    }

    #[test]
    fn an_undecodable_hand_is_refused_with_a_reason() {
        let error = decode_hand(b"not a png", BUNDLED_HAND_MASK).unwrap_err();
        assert!(error.to_string().contains("hand image"), "got: {error}");
    }

    #[test]
    fn one_half_can_be_a_file_and_the_other_the_bundled_asset() {
        let directory = tempfile::tempdir().unwrap();
        let image_path = directory.path().join("drawing-hand.png");
        std::fs::write(&image_path, BUNDLED_HAND_IMAGE).unwrap();

        let hand = HandSource::from_files(Some(image_path.clone()), None)
            .load()
            .unwrap();

        assert_eq!(hand.dimensions().width(), 285);
        assert_eq!(
            HandSource::from_files(Some(image_path), None),
            HandSource::new(
                HandAsset::File(directory.path().join("drawing-hand.png")),
                HandAsset::Bundled
            )
        );
    }

    #[test]
    fn a_chosen_file_that_is_not_there_is_refused_with_its_path() {
        let error = HandSource::from_files(Some(PathBuf::from("C:/nowhere/hand.png")), None)
            .load()
            .unwrap_err();
        assert!(
            error.to_string().contains("C:/nowhere/hand.png"),
            "got: {error}"
        );
    }

    /// A greyscale PNG built in memory, so a test can describe a mask without a fixture file.
    fn grey_png(values: &[u8], width: u32, height: u32) -> Vec<u8> {
        let image = image::GrayImage::from_raw(width, height, values.to_vec()).unwrap();
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageLuma8(image)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }
}
