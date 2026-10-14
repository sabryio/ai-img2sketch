"""Dimension adjustment service."""

from ...domain.value_objects.dimensions import Dimensions


class DimensionAdjuster:
    """Adjusts image dimensions so they are compatible with the grid split length.

    The drawing algorithm splits the image into equal ``split_len`` x ``split_len``
    cells using :func:`numpy.split`, which requires the width and height to be exact
    multiples of ``split_len``. This service rounds each dimension to the nearest
    such multiple.
    """

    @staticmethod
    def adjust_to_multiple(dimensions: Dimensions, split_len: int) -> Dimensions:
        """Return dimensions whose width and height are multiples of ``split_len``."""
        return Dimensions(
            width=DimensionAdjuster._adjust_dimension(dimensions.width, split_len),
            height=DimensionAdjuster._adjust_dimension(dimensions.height, split_len),
        )

    @staticmethod
    def _adjust_dimension(value: int, split_len: int) -> int:
        """Round ``value`` to the nearest non-zero multiple of ``split_len``."""
        remainder = value % split_len
        if remainder == 0:
            return value

        lower = value - remainder
        upper = lower + split_len

        # Never produce a zero/negative dimension for tiny images.
        if lower < split_len:
            return upper
        return lower if remainder <= split_len - remainder else upper

    @staticmethod
    def get_common_divisors(dim1: Dimensions, dim2: Dimensions) -> list[int]:
        """Get common divisors of two dimensions."""
        return dim1.find_common_divisors(dim2)
