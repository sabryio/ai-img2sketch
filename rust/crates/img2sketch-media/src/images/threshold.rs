//! Reducing a colour image to grey, and then to ink and paper.
//!
//! The highest-risk part of the port, and no longer the least certain: every step below is
//! OpenCV's, read from the source rather than guessed at, and pinned to the real library's
//! answers.
//!
//! - **Grey** is OpenCV's integer luma at `gray_shift` of 15: `(r*9798 + g*19235 + b*3735 +
//!   16384) >> 15`. Those are the Rec.601 coefficients scaled to 15 bits and adjusted to sum to
//!   exactly `1 << 15`, which the constructor asserts. A hand-rolled `0.299r + 0.587g + 0.114b`
//!   in floating point lands a least-significant bit away on the values that fall exactly on a
//!   half — and a least-significant bit is enough to change a threshold decision.
//! - **The local mean** is the part that is not what it looks like. `adaptiveThreshold` does not
//!   blur the 8-bit image. It promotes the grey image to `CV_32F`, blurs *that*, and converts the
//!   result back, so the kernel is the *float* one, not the 8-bit fixed-point kernel the
//!   standalone `GaussianBlur` uses, and the arithmetic is a float convolution. The sigma is
//!   `0.3 * ((block - 1) * 0.5 - 1) + 0.8` — 2.6 at the default block size — and the border is
//!   replicated.
//! - **The comparison** is `pixel > (mean - C)`, strictly greater, giving `255` or `0`. `C` is
//!   `cvCeil(delta)`, an integer here, and the mean is the rounded 8-bit one, because OpenCV
//!   converts the blurred float image back before comparing.
//!
//! The one place this port cannot be identical is the summation order inside the float blur.
//! OpenCV accumulates in `float` in whatever order its vector kernel happens to pick, and its own
//! answer is a half-ulp smaller or larger than the correctly rounded one depending on the machine's
//! instruction set. This accumulates in `f64` and rounds once, which *is* the correctly rounded
//! value — on the 400x300 parity image it agrees with the library on all 120 000 pixels, where a
//! `f32` accumulation differs on one. Where OpenCV's own arithmetic has drifted off the correctly
//! rounded value, no implementation can agree with it without copying the instruction set.
//!
//! [`docs/parity.md`]: ../../../../docs/parity.md

use img2sketch_core::domain::{GrayImage, GrayImageError};

use super::rounding::to_byte;

/// The block size the Python engine thresholds with by default.
pub const DEFAULT_BLOCK_SIZE: u32 = 15;

/// The constant the Python engine subtracts from the local mean by default.
pub const DEFAULT_CONSTANT: i32 = 10;

/// The red coefficient of OpenCV's luma, at 15-bit precision.
const RED_TO_LUMA: u32 = 9798;

/// The green coefficient of OpenCV's luma, at 15-bit precision.
const GREEN_TO_LUMA: u32 = 19235;

/// The blue coefficient of OpenCV's luma, at 15-bit precision.
const BLUE_TO_LUMA: u32 = 3735;

/// The luma of a colour frame, in OpenCV's arithmetic.
///
/// # Errors
///
/// Returns [`GrayImageError`] if the result does not match the frame's size, which cannot happen
/// for a frame that is three bytes per pixel — but the type refuses to be built on trust.
pub fn to_grayscale(frame: &img2sketch_core::domain::Frame) -> Result<GrayImage, GrayImageError> {
    let mut pixels = Vec::with_capacity(frame.dimensions().pixel_count() as usize);
    for chunk in frame.rgb().as_chunks::<3>().0 {
        let red = u32::from(chunk[0]);
        let green = u32::from(chunk[1]);
        let blue = u32::from(chunk[2]);
        let luma = red * RED_TO_LUMA + green * GREEN_TO_LUMA + blue * BLUE_TO_LUMA;
        pixels.push(((luma + (1 << 14)) >> 15) as u8);
    }
    GrayImage::new(frame.dimensions(), pixels)
}

/// Thresholds a grey image against its own local mean.
///
/// A pixel is ink (`0`) when it is darker than the Gaussian-weighted mean of its neighbourhood
/// minus `constant`; everything else is paper (`255`).
///
/// # Errors
///
/// Returns [`GrayImageError`] if the result does not match the image's size.
pub fn gaussian_adaptive_threshold(
    image: &GrayImage,
    block_size: u32,
    constant: i32,
) -> Result<GrayImage, GrayImageError> {
    let blurred = gaussian_blur(image, block_size)?;
    let threshold_at = |value: u8| i32::from(value) - constant;

    let pixels = image
        .pixels()
        .iter()
        .zip(blurred.pixels())
        .map(|(source, mean)| {
            if i32::from(*source) > threshold_at(*mean) {
                255
            } else {
                0
            }
        })
        .collect();

    GrayImage::new(image.dimensions(), pixels)
}

/// Blurs a grey image with a Gaussian kernel of `block_size`, replicating the border.
///
/// The result is 8-bit, because OpenCV's is: the threshold compares against the rounded mean.
///
/// # Errors
///
/// Returns [`GrayImageError`] if the result does not match the image's size.
pub fn gaussian_blur(image: &GrayImage, block_size: u32) -> Result<GrayImage, GrayImageError> {
    let kernel = gaussian_kernel(block_size);
    let width = image.width() as usize;
    let height = image.height() as usize;
    let half = (kernel.len() / 2) as isize;
    let source = image.pixels();

    // Across, keeping the intermediate wide. OpenCV keeps it in `f32` and both passes are `f32`
    // there; the wider intermediate is what reproduces its *answer*, for the reason the module
    // note gives.
    let mut across = vec![0f64; width * height];
    for y in 0..height {
        for x in 0..width {
            let mut sum = 0.0;
            for (offset, weight) in kernel.iter().enumerate() {
                let source_x = (x as isize + offset as isize - half).clamp(0, width as isize - 1);
                sum += f64::from(source[y * width + source_x as usize]) * f64::from(*weight);
            }
            across[y * width + x] = sum;
        }
    }

    let mut pixels = vec![0u8; width * height];
    for y in 0..height {
        for x in 0..width {
            let mut sum = 0.0;
            for (offset, weight) in kernel.iter().enumerate() {
                let source_y = (y as isize + offset as isize - half).clamp(0, height as isize - 1);
                sum += across[source_y as usize * width + x] * f64::from(*weight);
            }
            // Rounding to `f32` first is OpenCV's `convertTo(CV_8U)` from a `CV_32F` image.
            pixels[y * width + x] = to_byte(sum as f32);
        }
    }

    GrayImage::new(image.dimensions(), pixels)
}

/// The Gaussian kernel OpenCV blurs with, as `CV_32F`.
///
/// `sigma` is OpenCV's, derived from the kernel size when none is given, which is the case
/// `adaptiveThreshold` uses. An even block size is not a kernel OpenCV accepts, so it is widened
/// by one rather than silently producing a lopsided kernel.
///
/// The values are computed in `f64` and truncated to `f32` because that is what OpenCV does: its
/// kernel is a bit-exact `softdouble` computation cast to `float`. The truncation is not a loss of
/// information — it is the kernel, and the tests pin it bit for bit against the library's.
#[must_use]
pub fn gaussian_kernel(block_size: u32) -> Vec<f32> {
    let size = if block_size.is_multiple_of(2) {
        block_size + 1
    } else {
        block_size
    };
    if size <= 1 {
        return vec![1.0];
    }

    let sigma = 0.3 * ((f64::from(size) - 1.0) * 0.5 - 1.0) + 0.8;
    let half = (size / 2) as i64;
    let mut weights: Vec<f64> = (-half..=half)
        .map(|offset| {
            let square = (offset * offset) as f64;
            (-square / (2.0 * sigma * sigma)).exp()
        })
        .collect();
    let sum: f64 = weights.iter().sum();
    for weight in &mut weights {
        *weight /= sum;
    }
    weights.into_iter().map(|weight| weight as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::{gaussian_adaptive_threshold, gaussian_blur, gaussian_kernel, to_grayscale};
    use img2sketch_core::domain::{Dimensions, Frame, GrayImage};

    fn grey(width: u32, height: u32, value: u8) -> GrayImage {
        GrayImage::filled(Dimensions::new(width, height).unwrap(), value)
    }

    #[test]
    fn luma_is_opencvs_integer_luma() {
        let frame = Frame::new(
            Dimensions::new(4, 1).unwrap(),
            vec![
                255, 0, 0, // pure red
                0, 255, 0, // pure green
                0, 0, 255, // pure blue
                255, 255, 255,
            ],
        )
        .unwrap();
        let grey = to_grayscale(&frame).unwrap();

        // 0.299, 0.587 and 0.114 of full scale, in 15-bit fixed point — and the exact four values
        // `cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)` returns for the same input, which is what this
        // is pinned to rather than to the coefficients the arithmetic looks like it should give.
        assert_eq!(grey.pixels(), &[76, 150, 29, 255]);
    }

    #[test]
    fn luma_is_fixed_point_arithmetic_not_a_float_average() {
        // Every one of these has a `0.299r + 0.587g + 0.114b` that lands within a rounding step of
        // a half, and a float luma rounds three of them the other way: (176,112,238) and
        // (116,148,210) come out at exactly 145.5 — 146 by ties-to-even — and (252,158,179) at
        // exactly 188.5, which is 188. OpenCV answers 145, 145 and 189. These are the pixels the
        // 15-bit form exists for, and the expected values are `cv2.cvtColor`'s, not this
        // arithmetic's.
        let frame = Frame::new(
            Dimensions::new(6, 1).unwrap(),
            vec![
                176, 112, 238, // -> 145, a float luma gives 146
                116, 148, 210, // -> 145, a float luma gives 146
                252, 158, 179, // -> 189, a float luma gives 188
                97, 153, 199, // -> 141, a float luma gives 142
                162, 188, 129, // -> 174
                98, 41, 238, // -> 80
            ],
        )
        .unwrap();
        assert_eq!(
            to_grayscale(&frame).unwrap().pixels(),
            &[145, 145, 189, 141, 174, 80]
        );
    }

    #[test]
    fn the_kernel_is_opencvs_float_kernel_bit_for_bit() {
        // `cv2.getGaussianKernel(15, 2.6, cv2.CV_32F)`, which is the kernel `adaptiveThreshold`
        // convolves with. Truncating the `f64` kernel to `f32` is the whole of the difference
        // between this and the float form OpenCV computes in software. The values are given as bit
        // patterns because a decimal literal is not allowed to be long enough to round-trip
        // reliably, and this test is about bits.
        let expected: [f32; 15] = [
            f32::from_bits(0x3b86_9623),
            f32::from_bits(0x3c30_0526),
            f32::from_bits(0x3cc6_8dcb),
            f32::from_bits(0x3d41_2caa),
            f32::from_bits(0x3da2_18f7),
            f32::from_bits(0x3dea_a1ed),
            f32::from_bits(0x3e12_764e),
            f32::from_bits(0x3e1d_b4b1),
            f32::from_bits(0x3e12_764e),
            f32::from_bits(0x3dea_a1ed),
            f32::from_bits(0x3da2_18f7),
            f32::from_bits(0x3d41_2caa),
            f32::from_bits(0x3cc6_8dcb),
            f32::from_bits(0x3c30_0526),
            f32::from_bits(0x3b86_9623),
        ];
        let kernel = gaussian_kernel(15);
        assert_eq!(kernel.len(), expected.len());
        for (value, want) in kernel.iter().zip(&expected) {
            assert_eq!(value.to_bits(), want.to_bits(), "{value} is not {want}");
        }
    }

    #[test]
    fn a_flat_image_blurs_to_itself() {
        let image = grey(16, 16, 137);
        let blurred = gaussian_blur(&image, 15).unwrap();
        assert!(
            blurred.pixels().iter().all(|value| *value == 137),
            "a constant image has a constant local mean: {:?}",
            &blurred.pixels()[..16]
        );
    }

    #[test]
    fn the_kernel_sums_to_one_and_is_symmetric() {
        let kernel = gaussian_kernel(15);
        assert_eq!(kernel.len(), 15);
        let sum: f64 = kernel.iter().map(|value| f64::from(*value)).sum();
        // The `f32` values do not sum to one exactly — OpenCV's do not either — and the deficit is
        // what a constant image's mean carries.
        assert!((sum - 1.0).abs() < 1e-6, "sum was {sum}");

        let reversed: Vec<f32> = kernel.iter().rev().copied().collect();
        assert_eq!(kernel, reversed);
        assert!(kernel[7] > kernel[0], "the centre weighs most");
    }

    #[test]
    fn an_even_block_size_is_widened_rather_than_accepted() {
        assert_eq!(gaussian_kernel(16).len(), 17);
        assert_eq!(gaussian_kernel(0).len(), 1);
    }

    #[test]
    fn a_flat_image_has_no_ink() {
        // Nothing is darker than its own neighbourhood minus a constant, so a blank page stays
        // blank — and, in the drawing, has nothing to draw.
        let image = grey(20, 20, 255);
        let thresholded = gaussian_adaptive_threshold(&image, 15, 10).unwrap();
        assert!(thresholded.pixels().iter().all(|value| *value == 255));

        let dark = grey(20, 20, 0);
        let thresholded = gaussian_adaptive_threshold(&dark, 15, 10).unwrap();
        assert!(thresholded.pixels().iter().all(|value| *value == 255));
    }

    #[test]
    fn a_lone_dark_pixel_stays_ink_and_its_neighbours_stay_paper() {
        let mut image = grey(21, 21, 255);
        let width = 21usize;
        image.pixels_mut()[10 * width + 10] = 0;

        let thresholded = gaussian_adaptive_threshold(&image, 15, 10).unwrap();
        assert_eq!(thresholded.pixels()[10 * width + 10], 0, "the spot is ink");
        assert_eq!(
            thresholded.pixels()[10 * width + 11],
            255,
            "beside it is paper"
        );
        assert_eq!(
            thresholded
                .pixels()
                .iter()
                .filter(|value| **value == 0)
                .count(),
            1,
            "and nothing else darkened"
        );
    }

    #[test]
    fn the_constant_decides_how_much_has_to_be_darker_than_its_neighbourhood() {
        // A very low constant makes a faint dip ink; a very high one does not.
        let mut image = grey(21, 21, 200);
        let width = 21usize;
        image.pixels_mut()[10 * width + 10] = 195;

        let sensitive = gaussian_adaptive_threshold(&image, 15, 0).unwrap();
        let tolerant = gaussian_adaptive_threshold(&image, 15, 20).unwrap();
        assert_eq!(sensitive.pixels()[10 * width + 10], 0);
        assert_eq!(tolerant.pixels()[10 * width + 10], 255);
    }

    #[test]
    fn the_threshold_is_strictly_greater_than_the_mean_minus_the_constant() {
        // The boundary case: a pixel exactly equal to the local mean minus C is ink, not paper.
        let image = grey(15, 15, 100);
        let thresholded = gaussian_adaptive_threshold(&image, 15, 0).unwrap();
        // mean is 100, and 100 > 100 is false, so an unblurred uniform image is *all* ink.
        assert!(thresholded.pixels().iter().all(|value| *value == 0));
    }
}
