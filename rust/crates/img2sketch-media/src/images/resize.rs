//! Resampling the source image onto the drawing canvas.
//!
//! This is `cv2.resize(..., cv2.INTER_AREA)`, and it is no longer an approximation of it: the
//! arithmetic below is OpenCV's, fixed point and step by step, so the two agree bit for bit. That
//! precision is not perfectionism. A one-bit difference in one channel of one pixel can close a
//! one-pixel gap in an outline, the outline becomes the cells the drawing visits, and the route
//! that walks them is chaotic — one different cell turns the walk, and every frame after it
//! differs.
//!
//! `INTER_AREA` is three algorithms, and OpenCV chooses between them by the scale factor
//! (`modules/imgproc/src/resize.cpp`, `hal::resize`):
//!
//! - **Whole-block average** when *both* axes shrink by a whole number — 2×, 3×, and so on. Each
//!   destination pixel is the mean of the block it covers. A 2×2 block of a three-channel image is
//!   averaged by the vector kernel as `(a + b + c + d + 2) >> 2` before the scalar form is ever
//!   reached, and that `+ 2` is *not* the same rounding as the float mean: four values summing to
//!   six average to one, where rounding 1.5 to even gives two. Every other block size is averaged
//!   as `saturate_cast<uchar>(sum * (1.f / area))`, and destination columns whose block runs off
//!   the right edge are averaged over the pixels that are there.
//! - **Overlap average** when both axes shrink but not by a whole number. OpenCV builds a tap
//!   table of `(destination, source, weight)` with `f32` weights — the share of each source pixel
//!   the destination pixel covers, normalised by how much was covered — then accumulates in `f32`
//!   across and down, converting to 8 bits only when a destination row is complete.
//! - **Bilinear taps** when *either* axis grows. This is the counter-intuitive one. OpenCV
//!   documents `INTER_AREA` when zooming as "similar to `INTER_NEAREST`", and one would expect
//!   either a nearest neighbour or the interval overlap the other two paths suggest. It is
//!   neither. A zoom on one axis sends *both* axes down this path, where OpenCV takes the interval
//!   the destination pixel covers, finds the two source pixels around it, and mixes them with
//!   11-bit fixed-point weights — rounding the horizontal intermediate to 8 bits and rounding
//!   again when the vertical pair is combined. Interval-overlap averaging agrees with it on the
//!   small ramps that make the two look like the same operation, which is what made this the last
//!   path to fall.
//!
//! Four things this deliberately does not carry over, all of them unobservable:
//! OpenCV reads one pixel past the right edge and one row past the bottom in the zoom case, where
//! the weight is zero; it saturates a vertical result that cannot reach the saturation point when
//! the weights sum to 2048; it splits the work across threads by row group, which does not change
//! any group's summation order; and it reuses the horizontal pass between destination rows, which
//! only saves work. The sums are accumulated in `f64` rather than `f32` on purpose — see
//! [`super::threshold`] for that argument, which is the same one.
//!
//! [`docs/parity.md`]: ../../../../docs/parity.md

use img2sketch_core::domain::{Dimensions, Frame, FrameError};

use super::rounding::{nearest_even, to_byte};

/// The fixed-point scale OpenCV keeps its interpolation weights at (`INTER_RESIZE_COEF_BITS`).
const COEFF_SCALE: f32 = 2048.0;

/// The number of channels a frame carries.
const CHANNELS: usize = 3;

/// Resizes a frame with area averaging, the way OpenCV does it.
///
/// # Errors
///
/// Returns [`FrameError`] only if the resized buffer does not match the target size, which the
/// arithmetic below makes unreachable.
pub fn resize_area(source: &Frame, target: Dimensions) -> Result<Frame, FrameError> {
    if source.dimensions() == target {
        return Ok(source.clone());
    }

    Frame::new(target, resample(source, target))
}

/// Picks the path OpenCV would take, and runs it.
fn resample(source: &Frame, target: Dimensions) -> Vec<u8> {
    // `cv::resize` hands `hal::resize` the reciprocal of the scale, which turns it back into
    // `source / target`.
    let inv_x = f64::from(target.width()) / f64::from(source.width());
    let inv_y = f64::from(target.height()) / f64::from(source.height());
    let scale_x = 1.0 / inv_x;
    let scale_y = 1.0 / inv_y;

    // True area resampling needs a shrinking on *both* axes. One axis growing sends both down the
    // generic path, including the axis that is shrinking.
    if scale_x >= 1.0 && scale_y >= 1.0 {
        let whole_x = scale_x.round_ties_even();
        let whole_y = scale_y.round_ties_even();
        if (scale_x - whole_x).abs() < f64::EPSILON && (scale_y - whole_y).abs() < f64::EPSILON {
            return whole_block_average(source, target, whole_x as usize, whole_y as usize);
        }
        return overlap_average(source, target, scale_x, scale_y);
    }

    bilinear_average(source, target, inv_x, inv_y)
}

/// OpenCV's `resizeAreaFast_`: both axes shrink by a whole number.
fn whole_block_average(
    source: &Frame,
    target: Dimensions,
    scale_x: usize,
    scale_y: usize,
) -> Vec<u8> {
    let source_width = source.width() as usize;
    let source_height = source.height() as usize;
    let target_width = target.width() as usize;
    let target_height = target.height() as usize;
    let rgb = source.rgb();
    let stride = source_width * CHANNELS;
    let area = scale_x * scale_y;
    let scale = 1.0f32 / area as f32;
    // How many channels whole blocks cover. The rest of a row, if any, is covered partially.
    let whole_width = (source_width / scale_x) * CHANNELS;
    // The vector kernel only handles a 2x2 block, and only for one, three or four channels; every
    // other block size goes through the scalar sum, which rounds differently.
    let vector_block = scale_x == 2 && scale_y == 2;
    // OpenCV's `ofs`: every pixel of the block, as an offset from the block's first pixel.
    let block: Vec<usize> = (0..scale_y)
        .flat_map(|row| (0..scale_x).map(move |column| row * stride + column * CHANNELS))
        .collect();

    let mut pixels = vec![0u8; target_width * target_height * CHANNELS];
    for row in 0..target_height {
        let first_source_row = row * scale_y;
        if first_source_row >= source_height {
            continue;
        }
        let whole = if first_source_row + scale_y <= source_height {
            whole_width
        } else {
            0
        };
        let out = &mut pixels[row * target_width * CHANNELS..][..target_width * CHANNELS];
        let mut channel = 0;

        if vector_block {
            while channel < whole {
                for offset in 0..CHANNELS {
                    let index = first_source_row * stride + channel * 2 + offset;
                    let below = index + stride;
                    let sum = usize::from(rgb[index])
                        + usize::from(rgb[index + CHANNELS])
                        + usize::from(rgb[below])
                        + usize::from(rgb[below + CHANNELS]);
                    out[channel + offset] = ((sum + 2) >> 2) as u8;
                }
                channel += CHANNELS;
            }
        } else {
            while channel < whole {
                let base = block_start(channel, scale_x);
                let mut sum = 0usize;
                for offset in &block {
                    sum += usize::from(rgb[first_source_row * stride + base + offset]);
                }
                out[channel] = to_byte(sum as f32 * scale);
                channel += 1;
            }
        }

        // Whatever is left of the row, when the source is not a whole number of blocks wide.
        while channel < target_width * CHANNELS {
            let base = block_start(channel, scale_x);
            let mut sum = 0usize;
            let mut count = 0usize;
            for line in 0..scale_y {
                if first_source_row + line >= source_height {
                    break;
                }
                for column in (0..scale_x * CHANNELS).step_by(CHANNELS) {
                    if base + column >= stride {
                        break;
                    }
                    sum += usize::from(rgb[(first_source_row + line) * stride + base + column]);
                    count += 1;
                }
            }
            out[channel] = if count == 0 {
                0
            } else {
                to_byte(sum as f32 / count as f32)
            };
            channel += 1;
        }
    }
    pixels
}

/// OpenCV's `xofs`: the source channel a destination channel's block starts at.
fn block_start(channel: usize, scale_x: usize) -> usize {
    (channel / CHANNELS) * scale_x * CHANNELS + channel % CHANNELS
}

/// OpenCV's `resizeArea_`: both axes shrink by a fraction.
fn overlap_average(source: &Frame, target: Dimensions, scale_x: f64, scale_y: f64) -> Vec<u8> {
    let source_width = source.width() as usize;
    let source_height = source.height() as usize;
    let target_width = target.width() as usize;
    let target_height = target.height() as usize;
    let stride = source_width * CHANNELS;
    let line_width = target_width * CHANNELS;

    let across = overlap_taps(source_width, target_width, CHANNELS, scale_x);
    let down = overlap_taps(source_height, target_height, 1, scale_y);

    let mut pixels = vec![0u8; line_width * target_height];
    let mut total = vec![0f32; line_width];
    let mut current: Option<usize> = None;

    for tap in &down {
        let row = &source.rgb()[tap.source * stride..][..stride];
        let mut line = vec![0f32; line_width];
        for weight in &across {
            for channel in 0..CHANNELS {
                line[weight.destination + channel] +=
                    f32::from(row[weight.source + channel]) * weight.alpha;
            }
        }

        if current == Some(tap.destination) {
            for (slot, value) in total.iter_mut().zip(&line) {
                *slot += tap.alpha * value;
            }
        } else {
            if let Some(finished) = current {
                store_row(&total, &mut pixels[finished * line_width..][..line_width]);
            }
            for (slot, value) in total.iter_mut().zip(&line) {
                *slot = tap.alpha * value;
            }
            current = Some(tap.destination);
        }
    }

    if let Some(finished) = current {
        store_row(&total, &mut pixels[finished * line_width..][..line_width]);
    }
    pixels
}

/// Finishes a destination row: OpenCV's `saturate_store`.
fn store_row(total: &[f32], row: &mut [u8]) {
    for (value, slot) in total.iter().zip(row.iter_mut()) {
        *slot = to_byte(*value);
    }
}

/// One destination pixel's share of one source pixel along one axis.
#[derive(Debug, Clone, Copy)]
struct DecimateAlpha {
    /// Where in the destination row the share lands, in channels.
    destination: usize,
    /// Where in the source row it comes from, in channels.
    source: usize,
    /// How much of it, normalised so that one destination pixel's shares sum to one.
    alpha: f32,
}

/// OpenCV's `computeResizeAreaTab`: the overlap weights for one axis.
fn overlap_taps(
    source_len: usize,
    target_len: usize,
    channels: usize,
    scale: f64,
) -> Vec<DecimateAlpha> {
    let mut taps = Vec::new();
    for index in 0..target_len {
        let start = index as f64 * scale;
        let end = start + scale;
        // The destination pixel covers `[start, end)` of the source, except at the far edge, where
        // the source runs out first and the share has to be normalised by what is really there.
        let cell = scale.min(source_len as f64 - start);
        let mut first = start.ceil() as i64;
        let last = ((end.floor() as i64).min(source_len as i64 - 1)).max(0);
        first = first.min(last);

        // The partial pixel at the leading edge, when the interval does not start on a boundary.
        if first as f64 - start > 1e-3 {
            taps.push(DecimateAlpha {
                destination: index * channels,
                source: (first as usize - 1) * channels,
                alpha: ((first as f64 - start) / cell) as f32,
            });
        }
        // The whole pixels the interval spans.
        for pixel in first..last {
            taps.push(DecimateAlpha {
                destination: index * channels,
                source: pixel as usize * channels,
                alpha: (1.0 / cell) as f32,
            });
        }
        // And the partial pixel at the trailing edge.
        if end - last as f64 > 1e-3 {
            taps.push(DecimateAlpha {
                destination: index * channels,
                source: last as usize * channels,
                alpha: (((end - last as f64).min(1.0)).min(cell) / cell) as f32,
            });
        }
    }
    taps
}

/// OpenCV's generic `area_mode` path: bilinear taps in 11-bit fixed point.
fn bilinear_average(source: &Frame, target: Dimensions, inv_x: f64, inv_y: f64) -> Vec<u8> {
    let source_width = source.width() as usize;
    let source_height = source.height() as usize;
    let target_width = target.width() as usize;
    let target_height = target.height() as usize;
    let stride = source_width * CHANNELS;
    let line_width = target_width * CHANNELS;

    let across = bilinear_taps(source_width, target_width, inv_x);
    let down = bilinear_taps(source_height, target_height, inv_y);

    let mut pixels = vec![0u8; line_width * target_height];
    for (row, tap) in down.iter().enumerate() {
        let upper = horizontal_line(source.rgb(), &across, tap.source, stride, line_width);
        let below = (tap.source + 1).min(source_height - 1);
        let lower = horizontal_line(source.rgb(), &across, below, stride, line_width);
        let out = &mut pixels[row * line_width..][..line_width];
        for channel in 0..line_width {
            // `>> 4` and then `>> 16` is OpenCV's: the horizontal intermediate loses its bottom
            // four bits before the vertical weights ever see it.
            let combined = ((tap.near * (upper[channel] >> 4)) >> 16)
                + ((tap.far * (lower[channel] >> 4)) >> 16);
            out[channel] = ((combined + 2) >> 2).clamp(0, 255) as u8;
        }
    }
    pixels
}

/// The two source pixels one destination pixel mixes along one axis.
#[derive(Debug, Clone, Copy)]
struct BilinearTap {
    /// The source pixel the coverage interval starts in.
    source: usize,
    /// The weight of that pixel, scaled by 2048.
    near: i32,
    /// The weight of the next one, scaled by 2048.
    far: i32,
}

/// OpenCV's per-axis taps for the zoom case.
fn bilinear_taps(source_len: usize, target_len: usize, inv_scale: f64) -> Vec<BilinearTap> {
    let scale = 1.0 / inv_scale;
    (0..target_len)
        .map(|index| {
            let mut origin = (index as f64 * scale).floor() as i64;
            // OpenCV measures the fraction from the far edge of the interval, not from its start,
            // and clamps it: a destination pixel narrower than a source pixel takes one whole.
            let raw = ((index as f64 + 1.0) - (origin as f64 + 1.0) * inv_scale) as f32;
            let mut fraction = if raw <= 0.0 { 0.0 } else { raw - raw.floor() };
            if origin as usize >= source_len - 1 {
                fraction = 0.0;
                origin = source_len as i64 - 1;
            }
            BilinearTap {
                source: origin as usize,
                near: nearest_even((1.0f32 - fraction) * COEFF_SCALE),
                far: nearest_even(fraction * COEFF_SCALE),
            }
        })
        .collect()
}

/// The horizontally resampled form of one source row, in 11-bit fixed point.
fn horizontal_line(
    rgb: &[u8],
    taps: &[BilinearTap],
    row: usize,
    stride: usize,
    width: usize,
) -> Vec<i32> {
    let line = &rgb[row * stride..][..stride];
    let mut out = vec![0i32; width];
    for (index, tap) in taps.iter().enumerate() {
        let near = tap.source * CHANNELS;
        // A destination pixel in the last source pixel has a zero second weight, so which pixel it
        // reads is immaterial — which is why reading one past the edge costs OpenCV nothing.
        let far = (tap.source + 1).min(stride / CHANNELS - 1) * CHANNELS;
        for channel in 0..CHANNELS {
            out[index * CHANNELS + channel] = i32::from(line[near + channel]) * tap.near
                + i32::from(line[far + channel]) * tap.far;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::resize_area;
    use img2sketch_core::domain::{Dimensions, Frame};

    /// A frame whose red channel is the column index times the row width plus the column, its
    /// green channel twice that, and its blue channel a constant — the pattern the golden values
    /// below were taken from.
    fn pattern(width: u32, height: u32) -> Frame {
        let mut rgb = Vec::new();
        for y in 0..height {
            for x in 0..width {
                let red = ((y * width + x) % 256) as u8;
                rgb.extend_from_slice(&[red, red.wrapping_mul(2), 7]);
            }
        }
        Frame::new(Dimensions::new(width, height).unwrap(), rgb).unwrap()
    }

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
    fn a_two_by_two_block_rounds_its_half_values_open_cvs_way() {
        // The 2x2 vector kernel averages with `(a + b + c + d + 2) >> 2`, not with a float mean.
        // Four values summing to 2 are the separation: the integer form gives 1, and rounding the
        // mean of 0.5 to even gives 0. `cv2.resize` gives 1.
        let frame = Frame::new(
            Dimensions::new(2, 2).unwrap(),
            vec![
                0, 0, 0, 0, 0, 0, // row 0
                0, 0, 0, 2, 0, 0, // row 1
            ],
        )
        .unwrap();
        let resized = resize_area(&frame, Dimensions::new(1, 1).unwrap()).unwrap();
        assert_eq!(pixel(&resized, 0, 0), [1, 0, 0]);
    }

    #[test]
    fn a_whole_number_shrink_takes_block_means() {
        // 6x6 onto 2x2: nine pixels per destination pixel. Every value is cv2's.
        let resized = resize_area(&pattern(6, 6), Dimensions::new(2, 2).unwrap()).unwrap();

        assert_eq!(pixel(&resized, 0, 0), [7, 14, 7]);
        assert_eq!(pixel(&resized, 1, 0), [10, 20, 7]);
        assert_eq!(pixel(&resized, 0, 1), [25, 50, 7]);
        assert_eq!(pixel(&resized, 1, 1), [28, 56, 7]);
    }

    #[test]
    fn a_fractional_shrink_takes_overlap_means() {
        // 6x6 onto 4x4, where each destination pixel covers one and a half source pixels in each
        // direction. Every value is cv2's.
        let resized = resize_area(&pattern(6, 6), Dimensions::new(4, 4).unwrap()).unwrap();

        assert_eq!(pixel(&resized, 0, 0), [2, 5, 7]);
        assert_eq!(pixel(&resized, 1, 0), [4, 7, 7]);
        assert_eq!(pixel(&resized, 3, 3), [33, 65, 7]);
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
        // The real case: 397x303 onto a 400x300 canvas. Whether an axis grows is decided by both
        // of them together — a zoom anywhere sends both down the bilinear path — and the answer
        // must not depend on the other one. Every value below is cv2's for the same input.
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
