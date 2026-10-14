"""Tests for the drawing-path and grid calculators."""

import numpy as np
import pytest

from ai_img2sketch.application.services.drawing_calculator import (
    DrawingPathCalculator,
    GridCalculator,
)
from ai_img2sketch.domain.value_objects.dimensions import Dimensions


def test_calculate_grid_dimensions() -> None:
    assert GridCalculator.calculate_grid_dimensions(Dimensions(width=10, height=20), 5) == (4, 2)


def test_split_into_grid_shape() -> None:
    image = np.zeros((4, 4), dtype=np.uint8)
    grid = GridCalculator.split_into_grid(image, 2, 2)
    assert grid.shape == (2, 2, 2, 2)


def test_split_into_grid_rejects_non_divisible_image() -> None:
    image = np.zeros((5, 5), dtype=np.uint8)
    with pytest.raises(ValueError, match="cannot be split"):
        GridCalculator.split_into_grid(image, 2, 2)


def test_find_grids_with_black_pixels() -> None:
    image = np.full((4, 4), 255, dtype=np.uint8)
    image[0:2, 0:2] = 0
    grid = GridCalculator.split_into_grid(image, 2, 2)
    black = GridCalculator.find_grids_with_black_pixels(grid, threshold=10)
    assert black.shape == (1, 2)
    assert list(black[0]) == [0, 0]


def test_euclidean_distance() -> None:
    points = np.array([[0, 0], [3, 4]])
    distances = DrawingPathCalculator.calculate_euclidean_distance(points, np.array([0, 0]))
    assert np.allclose(distances, [0.0, 5.0])


def test_find_nearest_index() -> None:
    points = np.array([[0, 0], [10, 10]])
    assert DrawingPathCalculator.find_nearest_index(points, np.array([9, 9])) == 1
