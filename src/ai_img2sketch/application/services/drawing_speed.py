"""Pure calculator that turns a target drawing duration into a skip rate.

A drawing frame is written every ``skip_rate`` grid cells, so the drawing phase
lasts ``floor(cell_count / skip_rate) / frame_rate`` seconds. Given a desired
duration this service solves that relation for ``skip_rate``.
"""

from __future__ import annotations


class DrawingSpeedCalculator:
    """Derives drawing speed parameters from a target drawing duration."""

    @staticmethod
    def estimate_drawing_seconds(cell_count: int, skip_rate: int, frame_rate: int) -> float:
        """Return the drawing duration produced by a given skip rate."""
        if frame_rate <= 0 or skip_rate <= 0 or cell_count <= 0:
            return 0.0
        return (cell_count // skip_rate) / frame_rate

    @staticmethod
    def skip_rate_for_duration(cell_count: int, draw_duration_sec: float, frame_rate: int) -> int:
        """Return the skip rate that draws ``cell_count`` cells in ~``draw_duration_sec``.

        The result is clamped to ``[1, cell_count]`` so the drawing never collapses
        to zero frames, even for very short or very long targets. Because frames are
        emitted in whole ``skip_rate`` steps, the achievable duration is quantised;
        the returned skip rate is the one whose resulting duration is closest to the
        target (ties prefer a smaller skip rate for smoother motion).
        """
        if cell_count <= 0 or frame_rate <= 0:
            return 1

        target_frames = max(1, round(draw_duration_sec * frame_rate))
        estimate = max(1, min(round(cell_count / target_frames), cell_count))

        candidates = {1, cell_count, estimate}
        for delta in (-1, 1):
            candidates.add(max(1, min(estimate + delta, cell_count)))

        return min(
            candidates,
            key=lambda skip_rate: (
                abs(
                    DrawingSpeedCalculator.estimate_drawing_seconds(
                        cell_count, skip_rate, frame_rate
                    )
                    - draw_duration_sec
                ),
                skip_rate,
            ),
        )
