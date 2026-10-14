"""Pure calculators for grid splitting and drawing-path ordering."""

import math

import numpy as np
import numpy.typing as npt

from ...domain.value_objects.dimensions import Dimensions


class DrawingPathCalculator:
    """Calculates the nearest drawing path using Euclidean distance."""

    @staticmethod
    def calculate_euclidean_distance(
        points: npt.NDArray[np.int_], target: npt.NDArray[np.int_]
    ) -> npt.NDArray[np.float64]:
        """Calculate the Euclidean distance from the target to all points."""
        square_sub = (points - target) ** 2
        return np.sqrt(np.sum(square_sub, axis=1))

    @staticmethod
    def find_nearest_index(points: npt.NDArray[np.int_], target: npt.NDArray[np.int_]) -> int:
        """Find the index of the point nearest to the target."""
        distances = DrawingPathCalculator.calculate_euclidean_distance(points, target)
        return int(np.argmin(distances))


class GridCalculator:
    """Calculates grid divisions for image processing."""

    @staticmethod
    def calculate_grid_dimensions(dimensions: Dimensions, split_len: int) -> tuple[int, int]:
        """Calculate the number of grid cuts (vertical, horizontal)."""
        n_cuts_vertical = math.ceil(dimensions.height / split_len)
        n_cuts_horizontal = math.ceil(dimensions.width / split_len)
        return n_cuts_vertical, n_cuts_horizontal

    @staticmethod
    def split_into_grid(image: npt.NDArray, n_vertical: int, n_horizontal: int) -> npt.NDArray:
        """Split an image into a grid of smaller sections.

        The image height must be divisible by ``n_vertical`` and its width by
        ``n_horizontal``; use :class:`DimensionAdjuster` beforehand to guarantee it.
        """
        height, width = image.shape[-2], image.shape[-1]
        if height % n_vertical != 0 or width % n_horizontal != 0:
            raise ValueError(
                f"Image of size {width}x{height} cannot be split into "
                f"{n_horizontal}x{n_vertical} equal cells"
            )

        # Split horizontally first, then vertically
        grid = np.array(np.split(image, n_horizontal, axis=-1))
        grid = np.array(np.split(grid, n_vertical, axis=-2))
        return grid

    @staticmethod
    def find_grids_with_black_pixels(
        grid: npt.NDArray, threshold: int = 10
    ) -> npt.NDArray[np.int_]:
        """Find grid cells containing black pixels below the threshold."""
        # Find cells with at least one pixel below the threshold
        has_black = (grid < threshold).astype(int)
        count_black = np.sum(np.sum(has_black, axis=-1), axis=-1)

        # Get indices of cells with black pixels
        black_indices = np.array(np.where(count_black > 0)).T
        return black_indices
