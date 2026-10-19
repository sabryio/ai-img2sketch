//! Turning "this drawing should take six seconds" into a skip rate.
//!
//! One frame is written every `skip_rate` cells, so a drawing lasts `floor(cells / skip_rate) /
//! frame_rate` seconds. Not every duration is reachable: the frame count is a whole number, so the
//! achievable durations are quantised. This service picks the *longest* duration that does not
//! exceed what was asked for, which is why a request for 5 seconds can come out as 4.8.
//!
//! It is the caller's job to say so when that happens — a silently shorter video is the kind of
//! thing a user notices and cannot explain.

/// The skip rate that best hits a target drawing duration.
#[derive(Debug, Clone, Copy, Default)]
pub struct DrawingSpeedCalculator;

impl DrawingSpeedCalculator {
    /// The drawing duration a skip rate produces.
    #[must_use]
    pub fn estimate_drawing_seconds(cell_count: u32, skip_rate: u32, frame_rate: u32) -> f64 {
        if frame_rate == 0 || skip_rate == 0 || cell_count == 0 {
            return 0.0;
        }
        f64::from(cell_count / skip_rate) / f64::from(frame_rate)
    }

    /// The largest skip rate whose drawing still fits in `draw_duration_sec`.
    ///
    /// The result is clamped to `1..=cell_count`, so a target shorter than a single frame draws as
    /// fast as possible rather than producing no frames at all.
    #[must_use]
    pub fn skip_rate_for_duration(cell_count: u32, draw_duration_sec: f32, frame_rate: u32) -> u32 {
        if cell_count == 0 || frame_rate == 0 {
            return 1;
        }

        // The most whole frames that fit in the target. The epsilon guards the arithmetic that
        // should land on an exact integer: `0.2 * 25` is not exactly 5 in binary floating point.
        let max_frames = (f64::from(draw_duration_sec) * f64::from(frame_rate) + 1e-9).floor();
        if max_frames < 1.0 {
            return cell_count;
        }

        // The smallest skip rate that keeps the frame count at or below that: the longest duration
        // that does not overshoot.
        let skip_rate = cell_count / (max_frames as u32 + 1) + 1;
        skip_rate.clamp(1, cell_count)
    }
}

#[cfg(test)]
mod tests {
    use super::DrawingSpeedCalculator;

    #[test]
    fn a_skip_rate_produces_a_duration() {
        assert_eq!(
            DrawingSpeedCalculator::estimate_drawing_seconds(100, 8, 25),
            12.0 / 25.0
        );
        assert_eq!(
            DrawingSpeedCalculator::estimate_drawing_seconds(100, 100, 25),
            1.0 / 25.0
        );
    }

    #[test]
    fn a_duration_that_cannot_be_reached_is_never_overshot() {
        for cells in [1u32, 17, 100, 1_000, 9_999] {
            for frames in [1u32, 25, 30, 60] {
                for target in [0.1f32, 1.0, 2.5, 6.0, 30.0, 600.0] {
                    let skip =
                        DrawingSpeedCalculator::skip_rate_for_duration(cells, target, frames);
                    assert!(
                        (1..=cells.max(1)).contains(&skip),
                        "skip {skip} for {cells} cells"
                    );
                    let achieved =
                        DrawingSpeedCalculator::estimate_drawing_seconds(cells, skip, frames);
                    assert!(
                        achieved <= f64::from(target) + 1.0 / f64::from(frames) + 0.1,
                        "{achieved}s overshoots {target}s for {cells} cells at {frames} fps"
                    );
                }
            }
        }
    }

    #[test]
    fn a_target_shorter_than_one_frame_draws_as_fast_as_it_can() {
        assert_eq!(
            DrawingSpeedCalculator::skip_rate_for_duration(500, 0.001, 25),
            500
        );
    }

    #[test]
    fn an_impossible_input_does_not_divide_by_zero() {
        assert_eq!(
            DrawingSpeedCalculator::skip_rate_for_duration(0, 5.0, 25),
            1
        );
        assert_eq!(
            DrawingSpeedCalculator::skip_rate_for_duration(100, 5.0, 0),
            1
        );
        assert_eq!(
            DrawingSpeedCalculator::estimate_drawing_seconds(100, 0, 25),
            0.0
        );
    }
}
