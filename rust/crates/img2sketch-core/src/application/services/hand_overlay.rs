//! Painting the drawing hand onto a frame.
//!
//! The blend is `frame * (1 - mask) + hand`, per channel, with two details inherited from the
//! Python engine that a cleaner-looking implementation would get wrong:
//!
//! - **The multiply truncates.** The mask is a fraction, so `frame * mask` is fractional, and the
//!   Python engine stores it back into an unsigned byte, which truncates toward zero. Rounding
//!   here would shift every blended pixel by up to one and would show up as a halo around the hand
//!   in a pixel comparison.
//! - **The add wraps.** The hand and the frame are both `uint8`, and `uint8 + uint8` in numpy
//!   wraps around rather than saturating. Saturating would be the "safer" arithmetic and would
//!   also be a visible difference wherever a light hand sits on a light frame.
//!
//! Both are deliberate ports. They are also the reason the hand sits *on* the marks: the hand is
//! composited over a copy of the frame that already has the current cell inked.

use crate::domain::{Frame, Hand};

/// Position and compositing for the drawing hand.
#[derive(Debug, Clone, Copy, Default)]
pub struct HandOverlay;

impl HandOverlay {
    /// The frame coordinates the hand's top-left corner goes to, for a cell.
    ///
    /// The hand lands just past the cell's top-left corner, so its wrist covers the stroke it has
    /// just made rather than the one ahead of it.
    #[must_use]
    pub const fn position(drawing_x: u32, drawing_y: u32, split_len: u32) -> (u32, u32) {
        (drawing_x + split_len / 2, drawing_y + split_len / 2)
    }

    /// Composites the hand onto a frame at `(x, y)`.
    ///
    /// The hand is cropped to whatever part of it fits: a hand near the bottom-right corner shows
    /// its top-left part, which is what a hand entering the frame looks like. A hand entirely
    /// outside leaves the frame untouched.
    pub fn overlay(frame: &mut Frame, hand: &Hand, x: u32, y: u32) {
        let frame_dimensions = frame.dimensions();
        let hand_dimensions = hand.dimensions();

        let remaining_height = i64::from(frame_dimensions.height()) - i64::from(y);
        let remaining_width = i64::from(frame_dimensions.width()) - i64::from(x);
        let crop_height = remaining_height.min(i64::from(hand_dimensions.height()));
        let crop_width = remaining_width.min(i64::from(hand_dimensions.width()));
        if crop_height <= 0 || crop_width <= 0 {
            return;
        }
        let crop_height = crop_height as usize;
        let crop_width = crop_width as usize;

        let frame_width = frame_dimensions.width() as usize;
        let hand_width = hand_dimensions.width() as usize;
        let hand_pixels = hand.image().rgb();
        let inverse_mask = hand.inverse_mask();
        let pixels = frame.rgb_mut();

        for row in 0..crop_height {
            for column in 0..crop_width {
                let mask_index = row * hand_width + column;
                let alpha = inverse_mask.get(mask_index).copied().unwrap_or(0.0);
                let hand_index = mask_index * 3;
                let frame_index = ((y as usize + row) * frame_width + (x as usize + column)) * 3;

                for channel in 0..3 {
                    let frame_pixel = pixels[frame_index + channel];
                    // Truncating, not rounding: the Python engine stores a float into a byte.
                    let blended = (f64::from(frame_pixel) * alpha) as u8;
                    let hand_pixel = hand_pixels.get(hand_index + channel).copied().unwrap_or(0);
                    pixels[frame_index + channel] = blended.wrapping_add(hand_pixel);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::HandOverlay;
    use crate::domain::{Dimensions, Frame, Hand};

    fn hand(pixels: [u8; 3], mask: f64) -> Hand {
        Hand::new(
            Frame::filled(Dimensions::new(1, 1).unwrap(), pixels),
            vec![mask],
        )
        .unwrap()
    }

    fn frame_of(value: u8) -> Frame {
        Frame::filled(Dimensions::new(4, 4).unwrap(), [value, value, value])
    }

    #[test]
    fn centres_the_hand_on_the_stroke() {
        assert_eq!(HandOverlay::position(20, 30, 10), (25, 35));
        assert_eq!(HandOverlay::position(0, 0, 5), (2, 2));
    }

    #[test]
    fn a_fully_opaque_hand_replaces_the_frame() {
        let mut frame = frame_of(0);
        HandOverlay::overlay(&mut frame, &hand([10, 20, 30], 0.0), 0, 0);
        assert_eq!(&frame.rgb()[..3], &[10, 20, 30]);
    }

    #[test]
    fn a_transparent_mask_leaves_the_frame_alone() {
        // A transparent mask means the hand's own pixel is black there: the loader zeroes the hand
        // wherever the mask is empty, precisely so this leaves the frame untouched.
        let mut frame = frame_of(200);
        HandOverlay::overlay(&mut frame, &hand([0, 0, 0], 1.0), 0, 0);
        assert_eq!(&frame.rgb()[..3], &[200, 200, 200]);
    }

    #[test]
    fn the_hand_is_added_even_where_the_mask_is_transparent() {
        // The blend is `frame * mask + hand`, and the Python engine's `uint8 + uint8` adds the
        // hand's pixel whatever the mask says. Real hands have nothing to add there, but the
        // arithmetic is the arithmetic, and a "cleaner" `if mask == 1.0 { skip }` would be a
        // difference waiting to be found.
        let mut frame = frame_of(200);
        HandOverlay::overlay(&mut frame, &hand([10, 20, 30], 1.0), 0, 0);
        assert_eq!(&frame.rgb()[..3], &[210, 220, 230]);
    }

    #[test]
    fn a_half_transparent_pixel_truncates_rather_than_rounds() {
        let mut frame = frame_of(101);
        // 101 * 0.5 = 50.5, and the Python engine stores 50.
        HandOverlay::overlay(&mut frame, &hand([0, 0, 0], 0.5), 0, 0);
        assert_eq!(frame.rgb()[0], 50);
    }

    #[test]
    fn the_add_wraps_like_numpy_rather_than_saturating() {
        let mut frame = frame_of(250);
        HandOverlay::overlay(&mut frame, &hand([20, 20, 20], 1.0), 0, 0);
        assert_eq!(frame.rgb()[0], 14, "270 wraps to 14");
    }

    #[test]
    fn a_hand_hanging_off_the_corner_shows_its_top_left() {
        let mut frame = frame_of(0);
        let big_hand = Hand::new(
            Frame::filled(Dimensions::new(3, 3).unwrap(), [7, 7, 7]),
            vec![0.0; 9],
        )
        .unwrap();
        HandOverlay::overlay(&mut frame, &big_hand, 3, 3);

        // Only the frame's last column and row take the hand; everything else is untouched.
        let width = 4usize;
        let last_row = 3usize;
        let last_column = 3usize;
        let first = 0usize;
        let bottom_right = (last_row * width + last_column) * 3;
        let bottom_left = (last_row * width + first) * 3;

        assert_eq!(frame.rgb()[bottom_right], 7);
        assert_eq!(frame.rgb()[first], 0);
        assert_eq!(frame.rgb()[bottom_left], 0);
    }

    #[test]
    fn a_hand_entirely_outside_changes_nothing() {
        let mut frame = frame_of(9);
        HandOverlay::overlay(&mut frame, &hand([1, 1, 1], 0.0), 4, 0);
        assert_eq!(frame, frame_of(9));
    }
}
