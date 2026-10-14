"""Tests for the pure drawing-duration/skip-rate calculator."""

from ai_img2sketch.application.services.drawing_speed import DrawingSpeedCalculator


def test_estimate_uses_floor_of_cells_per_skip() -> None:
    # 44 cells, skip 8 -> floor(44/8) = 5 frames -> 5/25 s
    assert DrawingSpeedCalculator.estimate_drawing_seconds(44, 8, 25) == 5 / 25


def test_estimate_is_zero_for_degenerate_inputs() -> None:
    assert DrawingSpeedCalculator.estimate_drawing_seconds(0, 4, 25) == 0.0
    assert DrawingSpeedCalculator.estimate_drawing_seconds(40, 0, 25) == 0.0
    assert DrawingSpeedCalculator.estimate_drawing_seconds(40, 4, 0) == 0.0


def test_hits_a_reachable_duration_exactly() -> None:
    # 200 cells at 25 fps: 0.2 s == 5 frames -> skip 40
    skip_rate = DrawingSpeedCalculator.skip_rate_for_duration(200, 0.2, 25)
    assert DrawingSpeedCalculator.estimate_drawing_seconds(200, skip_rate, 25) == 0.2


def test_longer_duration_uses_a_smaller_or_equal_skip_rate() -> None:
    short = DrawingSpeedCalculator.skip_rate_for_duration(200, 0.5, 25)
    long = DrawingSpeedCalculator.skip_rate_for_duration(200, 4.0, 25)
    assert long <= short


def test_skip_rate_is_never_below_one() -> None:
    # A very long target cannot slow the drawing below one frame per cell.
    assert DrawingSpeedCalculator.skip_rate_for_duration(44, 600.0, 25) == 1


def test_skip_rate_always_stays_within_bounds() -> None:
    # The chosen skip rate must always allow at least one drawing frame and never
    # skip past the end of the drawing.
    for cell_count in (0, 1, 10, 44, 200, 5000):
        for duration in (0.1, 1.0, 3.0, 600.0):
            for frame_rate in (1, 25, 120):
                skip_rate = DrawingSpeedCalculator.skip_rate_for_duration(
                    cell_count, duration, frame_rate
                )
                assert 1 <= skip_rate <= max(1, cell_count)


def test_zero_cells_returns_one() -> None:
    assert DrawingSpeedCalculator.skip_rate_for_duration(0, 3.0, 25) == 1


def test_non_positive_frame_rate_returns_one() -> None:
    assert DrawingSpeedCalculator.skip_rate_for_duration(50, 3.0, 0) == 1


def test_target_is_floored_not_rounded_up() -> None:
    # 100 cells at 25 fps: skip 1 -> 4.0 s, skip 2 -> 2.0 s. A 3 s target must
    # floor to 2.0 s (skip 2), never round up to 4.0 s.
    skip_rate = DrawingSpeedCalculator.skip_rate_for_duration(100, 3.0, 25)
    achieved = DrawingSpeedCalculator.estimate_drawing_seconds(100, skip_rate, 25)

    assert achieved == 2.0
    assert achieved <= 3.0


def test_floor_picks_the_largest_duration_not_exceeding_the_target() -> None:
    # The chosen duration is <= the target, and any smaller skip rate (more
    # frames) would overshoot it.
    cell_count, frame_rate = 100, 25
    for target in (0.5, 1.0, 2.2, 3.0, 7.5, 12.0):
        skip_rate = DrawingSpeedCalculator.skip_rate_for_duration(cell_count, target, frame_rate)
        achieved = DrawingSpeedCalculator.estimate_drawing_seconds(
            cell_count, skip_rate, frame_rate
        )

        assert achieved <= target
        if skip_rate > 1:
            wider = DrawingSpeedCalculator.estimate_drawing_seconds(
                cell_count, skip_rate - 1, frame_rate
            )
            assert wider > target


def test_achieved_duration_never_exceeds_a_reachable_target() -> None:
    for cell_count in (1, 10, 44, 200, 5000):
        for frame_rate in (1, 25, 120):
            for target in (1.0, 3.0, 600.0):
                skip_rate = DrawingSpeedCalculator.skip_rate_for_duration(
                    cell_count, target, frame_rate
                )
                achieved = DrawingSpeedCalculator.estimate_drawing_seconds(
                    cell_count, skip_rate, frame_rate
                )
                if achieved > 0:
                    assert achieved <= target
