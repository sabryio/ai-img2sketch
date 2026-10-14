"""Dimension adjustment service."""

from ...domain.value_objects.dimensions import Dimensions


class DimensionAdjuster:
    """Service to adjust image dimensions to standard resolutions."""

    STANDARD_RESOLUTIONS = [
        360,
        480,
        640,
        720,
        1080,
        1280,
        1440,
        1920,
        2160,
        2560,
        3840,
        4320,
        7680,
    ]

    @classmethod
    def adjust_to_standard(cls, dimensions: Dimensions, split_len: int) -> Dimensions:
        """Adjust dimensions to nearest standard resolution if needed."""
        width = dimensions.width
        height = dimensions.height

        # Adjust if not divisible by split_len
        if height % split_len != 0:
            height = cls._find_nearest_resolution(height)

        if width % split_len != 0:
            width = cls._find_nearest_resolution(width)

        return Dimensions(width=width, height=height)

    @classmethod
    def _find_nearest_resolution(cls, value: int) -> int:
        """Find nearest standard resolution."""
        resolutions = cls.STANDARD_RESOLUTIONS
        differences = [abs(r - value) for r in resolutions]
        min_index = differences.index(min(differences))
        return resolutions[min_index]

    @staticmethod
    def get_common_divisors(dim1: Dimensions, dim2: Dimensions) -> list[int]:
        """Get common divisors of two dimensions."""
        return dim1.find_common_divisors(dim2)
