"""Tests for the ``Hand`` entity."""

import numpy as np
import pytest
from pydantic import ValidationError

from ai_img2sketch.domain.entities.hand import Hand
from ai_img2sketch.domain.value_objects.dimensions import Dimensions


def test_valid_hand() -> None:
    hand = Hand(
        image_data=np.zeros((2, 2, 3), dtype=np.uint8),
        inverse_mask=np.ones((2, 2), dtype=np.float64),
        dimensions=Dimensions(width=2, height=2),
    )
    assert hand.dimensions.width == 2
    assert hand.dimensions.height == 2


def test_rejects_mask_out_of_range() -> None:
    with pytest.raises(ValidationError):
        Hand(
            image_data=np.zeros((2, 2, 3), dtype=np.uint8),
            inverse_mask=np.full((2, 2), 2.0, dtype=np.float64),
            dimensions=Dimensions(width=2, height=2),
        )
