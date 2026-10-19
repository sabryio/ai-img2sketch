//! Resampling the source image onto the drawing canvas.
//!
//! This is `cv2.resize(..., cv2.INTER_AREA)`: each destination pixel is the average of the source
//! pixels it covers, weighted by how much of each it covers. The canvas moves by at most half a
//! split length, so the scale factor is usually a whole number and this is a box average — but not
//! always, and the general form is not much harder than the special case.
//!
//! **There is no special case for growing the image**, though it looks like there should be. OpenCV
//! documents `INTER_AREA` when zooming as "similar to `INTER_NEAREST`", and it is: a destination
//! pixel's interval is then *narrower* than a source pixel, so it lands inside one source pixel and
//! takes it whole. The only time more than one pixel is involved is when the interval straddles a
//! boundary, and then OpenCV mixes them by overlap like it does anywhere else — `[0, 10, 20]` grown
//! to seven pixels is `[0, 0, 7, 10, 13, 20, 20]`, not `[0, 0, 10, 10, 20, 20, 20]`. Treating the
//! zoom as plain nearest is the obvious reading of that documentation and it is wrong by a
//! pixel-width at every straddle.
//!
//! One difference remains, and it is the tolerance [`docs/parity.md`] describes: **the arithmetic
//! is `f64` throughout and rounds once, at the end.** OpenCV sums in fixed point and rounds its
//! intermediate, so the two disagree by one least-significant bit on the pixels where the two
//! roundings disagree — about a tenth of them, and never by more.
//!
//! [`docs/parity.md`]: ../../../../docs/parity.md

use img2sketch_core::domain::{Dimensions, Frame, FrameError};

/// How one destination pixel is built from the source pixels along a single axis.
#[derive(Debug, Clone, PartialEq)]
struct AxisTap {
    /// The first source pixel the destination pixel covers.
    start: u32,
    /// How much of each covered source pixel it takes, summing to 1.
    weights: Vec<f64>,
}

/// Works out how to resample one axis, once, for every row or column that needs it.
///
/// The scale factor maps the destination's pixel *intervals* onto the source: destination pixel `i`
/// covers source `[i * scale, (i + 1) * scale)`, and each source pixel it overlaps contributes in
/// proportion to the overlap. Normalising by that interval's width, rather than by the source
/// pixels' width, is what makes it an average of what was covered instead of a sum.
fn plan_axis(source_len: u32, target_len: u32) -> Vec<AxisTap> {
    let scale = f64::from(source_len) / f64::from(target_len);
    (0..target_len)
        .map(|index| {
            let start = f64::from(index) * scale;
            let end = f64::from(index + 1) * scale;
            let first = start.floor() as u32;
            let last = (end.ceil() as u32).min(source_len);
            let width = end - start;
            let weights = (first..last)
                .map(|pixel| {
                    let left = f64::from(pixel).max(start);
                    let right = (f64::from(pixel) + 1.0).min(end);
                    (right - left).max(0.0) / width
                })
                .collect();
            AxisTap {
                start: first,
                weights,
            }
        })
        .collect()
}

/// Resizes a frame with area averaging.
///
/// # Errors
///
/// Returns [`FrameError`] only if the resized buffer does not match the target size, which the
/// arithmetic below makes unreachable.
pub fn resize_area(source: &Frame, target: Dimensions) -> Result<Frame, FrameError> {
    if source.dimensions() == target {
        return Ok(source.clone());
    }

    let source_width = source.width() as usize;
    let source_height = source.height() as usize;
    let target_width = target.width() as usize;
    let target_height = target.height() as usize;

    let horizontal = plan_axis(source.width(), target.width());
    let vertical = plan_axis(source.height(), target.height());

    // Pass one: across, into a fractional buffer at (target width × source height). Keeping the
    // intermediate fractional is what stops a two-pass resize from rounding twice, which at these
    // scale factors would be the larger error of the two.
    let mut intermediate = vec![0f64; target_width * source_height * 3];
    for y in 0..source_height {
        for x in 0..target_width {
            let tap = &horizontal[x];
            let out = &mut intermediate[(y * target_width + x) * 3..][..3];
            for (channel, slot) in out.iter_mut().enumerate() {
                *slot = tap
                    .weights
                    .iter()
                    .enumerate()
                    .map(|(offset, weight)| {
                        f64::from(
                            source.rgb()
                                [(y * source_width + tap.start as usize + offset) * 3 + channel],
                        ) * weight
                    })
                    .sum();
            }
        }
    }

    // Pass two: down, into the output, rounding the one time the arithmetic is finished.
    let mut pixels = vec![0u8; target_width * target_height * 3];
    for (y, tap) in vertical.iter().enumerate() {
        for x in 0..target_width {
            let index = (y * target_width + x) * 3;
            for channel in 0..3 {
                let sum: f64 = tap
                    .weights
                    .iter()
                    .enumerate()
                    .map(|(offset, weight)| {
                        intermediate
                            [((tap.start as usize + offset) * target_width + x) * 3 + channel]
                            * weight
                    })
                    .sum();
                pixels[index + channel] = sum.round().clamp(0.0, 255.0) as u8;
            }
        }
    }

    Frame::new(target, pixels)
}

#[cfg(test)]
mod tests {
    use super::resize_area;
    use img2sketch_core::domain::{Dimensions, Frame};

    /// A frame whose red channel comes from `columns` and whose green channel doubles the row.
    fn ramp(width: u32, height: u32, columns: &[u8]) -> Frame {
        let mut rgb = Vec::new();
        for y in 0..height {
            for x in 0..width {
                rgb.extend_from_slice(&[columns[x as usize], (y * 2) as u8, 7]);
            }
        }
        Frame::new(Dimensions::new(width, height).unwrap(), rgb).unwrap()
    }

    fn pixel(frame: &Frame, x: u32, y: u32) -> [u8; 3] {
        let index = ((y * frame.width() + x) * 3) as usize;
        [
            frame.rgb()[index],
            frame.rgb()[index + 1],
            frame.rgb()[index + 2],
        ]
    }

    /// The red channel of a one-row frame, for comparing against `cv2`'s answer.
    fn row(columns: &[u8], target: u32) -> Vec<u8> {
        let frame = ramp(columns.len() as u32, 1, columns);
        let resized = resize_area(&frame, Dimensions::new(target, 1).unwrap()).unwrap();
        (0..target).map(|x| pixel(&resized, x, 0)[0]).collect()
    }

    #[test]
    fn a_size_that_is_already_right_is_returned_unchanged() {
        let frame = ramp(4, 4, &[0, 2, 4, 6]);
        assert_eq!(resize_area(&frame, frame.dimensions()).unwrap(), frame);
    }

    #[test]
    fn halving_averages_each_pair_exactly() {
        let frame = ramp(4, 4, &[0, 2, 4, 6]);
        let resized = resize_area(&frame, Dimensions::new(2, 2).unwrap()).unwrap();

        // Columns 0 and 2 average to 1; columns 4 and 6 average to 5. Rows 0 and 2 average to 1
        // and rows 4 and 6 to 5, so the green channel reads 1 or 5 across and down.
        assert_eq!(pixel(&resized, 0, 0), [1, 1, 7]);
        assert_eq!(pixel(&resized, 1, 0), [5, 1, 7]);
        assert_eq!(pixel(&resized, 0, 1), [1, 5, 7]);
        assert_eq!(pixel(&resized, 1, 1), [5, 5, 7]);
    }

    #[test]
    fn a_non_whole_scale_factor_keeps_what_it_can() {
        // Three destination pixels over seven source pixels of value 10: the average is 10
        // everywhere the source is uniform, whatever the weights are.
        let frame = Frame::filled(Dimensions::new(7, 7).unwrap(), [10, 20, 30]);
        let resized = resize_area(&frame, Dimensions::new(3, 3).unwrap()).unwrap();
        assert_eq!(resized.dimensions(), Dimensions::new(3, 3).unwrap());
        for y in 0..3 {
            for x in 0..3 {
                assert_eq!(pixel(&resized, x, y), [10, 20, 30]);
            }
        }
    }

    #[test]
    fn a_gradient_survives_a_resize() {
        // Two pixels of 0 and 2 halved exactly once: the average of the pair is 1.
        let frame = ramp(2, 1, &[0, 2]);
        let resized = resize_area(&frame, Dimensions::new(1, 1).unwrap()).unwrap();
        assert_eq!(pixel(&resized, 0, 0), [1, 0, 7]);
    }

    #[test]
    fn a_zoom_repeats_the_source_pixel_each_destination_lands_in() {
        // Every one of these is what `cv2.resize(..., cv2.INTER_AREA)` returns for the same input.
        // The middle values are the straddles: at two and a half source pixels per three
        // destination pixels, one destination pixel sits across the boundary and takes a share of
        // both.
        assert_eq!(row(&[0, 2], 5), vec![0, 0, 1, 2, 2]);
        assert_eq!(row(&[0, 10, 20], 7), vec![0, 0, 7, 10, 13, 20, 20]);
        assert_eq!(
            row(&[0, 100, 200, 255], 9),
            vec![0, 0, 75, 100, 150, 200, 214, 255, 255]
        );
    }

    #[test]
    fn a_zoom_of_a_single_pixel_does_not_read_past_the_edge() {
        let frame = Frame::filled(Dimensions::new(1, 1).unwrap(), [9, 9, 9]);
        let resized = resize_area(&frame, Dimensions::new(4, 4).unwrap()).unwrap();
        for y in 0..4 {
            for x in 0..4 {
                assert_eq!(pixel(&resized, x, y), [9, 9, 9]);
            }
        }
    }

    #[test]
    fn one_axis_can_grow_while_the_other_shrinks() {
        // The real case: 397x303 onto a 400x300 canvas. Whether an axis grows is decided per axis,
        // and the answer must not depend on the other one. Every value below is cv2's for the same
        // input.
        let frame = ramp(4, 3, &[0, 100, 200, 255]);
        let resized = resize_area(&frame, Dimensions::new(5, 2).unwrap()).unwrap();

        assert_eq!(resized.dimensions(), Dimensions::new(5, 2).unwrap());
        // Across, 4 -> 5: [0, 75, 150, 214, 255], with the straddle at the fourth pixel.
        assert_eq!(pixel(&resized, 0, 0), [0, 1, 7]);
        assert_eq!(pixel(&resized, 3, 0), [214, 1, 7]);
        // Down, 3 -> 2: the green channel is 0, 2, 4 per source row, so the two destination rows
        // read 1 and 3.
        assert_eq!(pixel(&resized, 0, 1), [0, 3, 7]);
    }
}
