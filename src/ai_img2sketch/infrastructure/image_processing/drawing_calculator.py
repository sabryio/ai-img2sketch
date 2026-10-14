"""Calculator for drawing paths and coordinates."""

import math

import numpy as np
import numpy.typing as npt

from ...domain.value_objects.dimensions import Dimensions


class DrawingPathCalculator:
    """Calculates optimal drawing paths using Euclidean distance."""

    @staticmethod
    def calculate_euclidean_distance(
        points: npt.NDArray[np.int_], target: npt.NDArray[np.int_]
    ) -> npt.NDArray[np.float64]:
        """Calculate Euclidean distance from target to all points."""
        square_sub = (points - target) ** 2
        return np.sqrt(np.sum(square_sub, axis=1))

    @staticmethod
    def find_nearest_index(points: npt.NDArray[np.int_], target: npt.NDArray[np.int_]) -> int:
        """Find index of nearest point to target."""
        distances = DrawingPathCalculator.calculate_euclidean_distance(points, target)
        return int(np.argmin(distances))


class GridCalculator:
    """Calculates grid divisions for image processing."""

    @staticmethod
    def calculate_grid_dimensions(dimensions: Dimensions, split_len: int) -> tuple[int, int]:
        """Calculate number of grid cuts (vertical, horizontal)."""
        n_cuts_vertical = math.ceil(dimensions.height / split_len)
        n_cuts_horizontal = math.ceil(dimensions.width / split_len)
        return n_cuts_vertical, n_cuts_horizontal

    @staticmethod
    def split_into_grid(image: npt.NDArray, n_vertical: int, n_horizontal: int) -> npt.NDArray:
        """Split image into grid of smaller sections."""
        # Split horizontally first, then vertically
        grid = np.array(np.split(image, n_horizontal, axis=-1))
        grid = np.array(np.split(grid, n_vertical, axis=-2))
        return grid

    @staticmethod
    def find_grids_with_black_pixels(
        grid: npt.NDArray, threshold: int = 10
    ) -> npt.NDArray[np.int_]:
        """Find grid cells containing black pixels below threshold."""
        # Find cells with at least one pixel below threshold
        has_black = (grid < threshold).astype(int)
        count_black = np.sum(np.sum(has_black, axis=-1), axis=-1)

        # Get indices of cells with black pixels
        black_indices = np.array(np.where(count_black > 0)).T
        return black_indices
