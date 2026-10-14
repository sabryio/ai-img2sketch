"""Tests for the ``ObjectMask`` value object."""

import numpy as np
import pytest
from pydantic import ValidationError

from ai_img2sketch.domain.value_objects.object_mask import ObjectMask


def test_valid_object_mask() -> None:
    mask = ObjectMask(name="face", region=np.zeros((4, 4), dtype=np.bool_), skip_rate=4)
    assert mask.name == "face"
    assert mask.skip_rate == 4


def test_catch_all_mask_allows_missing_region_and_skip_rate() -> None:
    mask = ObjectMask(name="background", region=None, skip_rate=None)
    assert mask.region is None
    assert mask.skip_rate is None


def test_rejects_non_2d_region() -> None:
    with pytest.raises(ValidationError):
        ObjectMask(name="face", region=np.zeros((2, 2, 2), dtype=np.bool_))


def test_rejects_non_positive_skip_rate() -> None:
    with pytest.raises(ValidationError):
        ObjectMask(name="face", region=None, skip_rate=0)
