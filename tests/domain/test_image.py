"""Tests for the ``Image`` entity."""

import numpy as np
import pytest
from pydantic import ValidationError

from ai_img2sketch.domain.entities.image import Image
from ai_img2sketch.domain.value_objects.dimensions import Dimensions


def test_from_array_infers_dimensions() -> None:
    data = np.zeros((10, 20, 3), dtype=np.uint8)
    image = Image.from_array(data)
    assert image.dimensions.width == 20
    assert image.dimensions.height == 10


def test_from_array_accepts_path() -> None:
    from pathlib import Path

    data = np.zeros((4, 4, 3), dtype=np.uint8)
    image = Image.from_array(data, Path("example.png"))
    assert image.path == Path("example.png")


def test_rejects_non_2d_or_3d_data() -> None:
    with pytest.raises(ValidationError):
        Image(data=np.zeros((5,), dtype=np.uint8), dimensions=Dimensions(width=1, height=1))


def test_rejects_non_array_data() -> None:
    with pytest.raises(ValidationError):
        Image(data="not-an-array", dimensions=Dimensions(width=1, height=1))
