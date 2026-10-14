"""Tests for the hand overlay service."""

import numpy as np

from ai_img2sketch.application.services.hand_overlay import HandOverlayService
from ai_img2sketch.domain.entities.hand import Hand
from ai_img2sketch.domain.value_objects.dimensions import Dimensions


def _hand(value: int = 5) -> Hand:
    return Hand(
        image_data=np.full((2, 2, 3), value, dtype=np.uint8),
        inverse_mask=np.zeros((2, 2), dtype=np.float64),
        dimensions=Dimensions(width=2, height=2),
    )


def test_calculate_hand_position() -> None:
    assert HandOverlayService.calculate_hand_position(10, 20, 4) == (12, 22)


def test_overlay_places_hand_on_frame() -> None:
    frame = np.zeros((4, 4, 3), dtype=np.uint8)
    result = HandOverlayService.overlay_hand(
        frame, _hand(), hand_x=1, hand_y=1, frame_dimensions=Dimensions(width=4, height=4)
    )
    assert result.shape == (4, 4, 3)
    assert result[1, 1, 0] == 5


def test_overlay_returns_frame_when_out_of_bounds() -> None:
    frame = np.zeros((4, 4, 3), dtype=np.uint8)
    result = HandOverlayService.overlay_hand(
        frame, _hand(), hand_x=4, hand_y=4, frame_dimensions=Dimensions(width=4, height=4)
    )
    assert np.array_equal(result, frame)
