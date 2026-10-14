"""Tests for the ``Dimensions`` value object."""

import pytest
from pydantic import ValidationError

from ai_img2sketch.domain.value_objects.dimensions import Dimensions


def test_aspect_ratio() -> None:
    dimensions = Dimensions(width=1920, height=1080)
    assert dimensions.aspect_ratio == pytest.approx(1.777, rel=1e-3)


def test_rejects_non_positive_dimensions() -> None:
    with pytest.raises(ValidationError):
        Dimensions(width=0, height=10)
    with pytest.raises(ValidationError):
        Dimensions(width=10, height=-1)


def test_is_immutable() -> None:
    dimensions = Dimensions(width=10, height=10)
    with pytest.raises(ValidationError):
        setattr(dimensions, "width", 20)  # noqa: B010 - intentionally test immutability


def test_find_common_divisors() -> None:
    a = Dimensions(width=8, height=8)
    b = Dimensions(width=8, height=8)
    assert a.find_common_divisors(b) == [1, 2, 4, 8]
