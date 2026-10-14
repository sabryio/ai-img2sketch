"""Pure calculator that turns a target drawing duration into a skip rate.

A drawing frame is written every ``skip_rate`` grid cells, so the drawing phase
lasts ``floor(cell_count / skip_rate) / frame_rate`` seconds. Given a desired
duration this service solves that relation for ``skip_rate``, flooring the
result so the drawing never runs longer than the target.
"""

from __future__ import annotations

import math


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
        """Return the skip rate that floors the drawing to ``draw_duration_sec``.

        Frames are emitted in whole ``skip_rate`` steps, so the achievable
        duration is quantised. This picks the *largest* achievable duration that
        does not exceed the target, i.e. the returned skip rate satisfies
        ``floor(cell_count / skip_rate) / frame_rate <= draw_duration_sec`` and
        is the closest such value to ``draw_duration_sec``. The result is clamped
        to ``[1, cell_count]`` so the drawing never collapses to zero frames.
        """
        if cell_count <= 0 or frame_rate <= 0:
            return 1

        # Largest whole number of drawing frames that still fits in the target.
        # The epsilon guards against floating-point error computing an exact
        # integer (e.g. 0.2 * 25 landing just below 5.0).
        max_frames = math.floor(draw_duration_sec * frame_rate + 1e-9)
        if max_frames < 1:
            # The target is shorter than a single frame; draw as fast as possible.
            return cell_count

        # Smallest skip rate that keeps the frame count at or below max_frames,
        # which yields the largest duration not exceeding the target.
        skip_rate = cell_count // (max_frames + 1) + 1
        return max(1, min(skip_rate, cell_count))
