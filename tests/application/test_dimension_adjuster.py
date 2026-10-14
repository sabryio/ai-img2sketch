"""Tests for the ``DimensionAdjuster`` service."""

from ai_img2sketch.application.services.dimension_adjuster import DimensionAdjuster
from ai_img2sketch.domain.value_objects.dimensions import Dimensions


def test_keeps_dimensions_when_divisible() -> None:
    dimensions = Dimensions(width=640, height=480)
    assert DimensionAdjuster.adjust_to_multiple(dimensions, 10) == dimensions


def test_rounds_down_to_nearest_multiple() -> None:
    adjusted = DimensionAdjuster.adjust_to_multiple(Dimensions(width=641, height=481), 10)
    assert adjusted == Dimensions(width=640, height=480)


def test_rounds_up_to_nearest_multiple() -> None:
    adjusted = DimensionAdjuster.adjust_to_multiple(Dimensions(width=107, height=103), 10)
    assert adjusted == Dimensions(width=110, height=100)


def test_result_is_always_divisible_by_split_len() -> None:
    for split_len in (7, 8, 9, 15, 16, 33):
        adjusted = DimensionAdjuster.adjust_to_multiple(
            Dimensions(width=1000, height=777), split_len
        )
        assert adjusted.width % split_len == 0
        assert adjusted.height % split_len == 0


def test_never_produces_zero_dimensions_for_tiny_images() -> None:
    assert DimensionAdjuster.adjust_to_multiple(Dimensions(width=4, height=4), 10) == Dimensions(
        width=10, height=10
    )


def test_get_common_divisors() -> None:
    dimensions = Dimensions(width=8, height=8)
    assert DimensionAdjuster.get_common_divisors(dimensions, dimensions) == [1, 2, 4, 8]
