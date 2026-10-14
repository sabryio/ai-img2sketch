"""Tests for the ``DrawingPlanner`` service."""

import numpy as np
import numpy.typing as npt

from ai_img2sketch.application.services.drawing_planner import DrawingPlanner
from ai_img2sketch.domain.value_objects.dimensions import Dimensions
from ai_img2sketch.domain.value_objects.object_mask import ObjectMask


def _region(shape: tuple[int, int], rows: tuple[int, int]) -> npt.NDArray[np.bool_]:
    region = np.zeros(shape, dtype=np.bool_)
    region[rows[0] : rows[1], :] = True
    return region


def test_no_masks_returns_a_single_group() -> None:
    cells = np.array([[0, 0], [1, 1]])
    groups = DrawingPlanner().plan(cells, [], Dimensions(width=4, height=4), 2, 7)

    assert len(groups) == 1
    assert groups[0].label == "image"
    assert groups[0].skip_rate == 7
    assert np.array_equal(groups[0].cells, cells)


def test_masks_are_ordered_and_carry_skip_rates() -> None:
    dimensions = Dimensions(width=6, height=6)
    top = ObjectMask(name="top", region=_region((6, 6), (0, 3)), skip_rate=3)
    bottom = ObjectMask(name="bottom", region=_region((6, 6), (3, 6)), skip_rate=None)

    cells = np.array([[2, 2], [0, 0]])  # bottom cell listed first in the input
    groups = DrawingPlanner().plan(cells, [top, bottom], dimensions, 2, default_skip_rate=9)

    assert [group.label for group in groups] == ["top", "bottom"]
    assert groups[0].skip_rate == 3
    assert groups[1].skip_rate == 9  # falls back to the default
    assert np.array_equal(groups[0].cells, np.array([[0, 0]]))
    assert np.array_equal(groups[1].cells, np.array([[2, 2]]))


def test_catch_all_object_owns_leftover_cells() -> None:
    dimensions = Dimensions(width=6, height=6)
    top = ObjectMask(name="top", region=_region((6, 6), (0, 3)), skip_rate=1)
    background = ObjectMask(name="background", region=None, skip_rate=1)

    cells = np.array([[0, 0], [2, 2]])
    groups = DrawingPlanner().plan(cells, [top, background], dimensions, 2, default_skip_rate=9)

    assert [group.label for group in groups] == ["top", "background"]
    assert np.array_equal(groups[1].cells, np.array([[2, 2]]))


def test_leftover_cells_form_background_group_without_catch_all() -> None:
    dimensions = Dimensions(width=6, height=6)
    top = ObjectMask(name="top", region=_region((6, 6), (0, 3)), skip_rate=1)

    cells = np.array([[0, 0], [2, 2]])
    groups = DrawingPlanner().plan(cells, [top], dimensions, 2, default_skip_rate=9)

    assert [group.label for group in groups] == ["top", "background"]
    assert groups[1].skip_rate == 9
    assert np.array_equal(groups[1].cells, np.array([[2, 2]]))
