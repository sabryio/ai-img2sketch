"""Dimension value objects."""

from pydantic import BaseModel, Field


class Dimensions(BaseModel):
    """Image or video dimensions with validation."""

    model_config = {"frozen": True}  # Make immutable

    width: int = Field(gt=0, description="Width in pixels")
    height: int = Field(gt=0, description="Height in pixels")

    @property
    def aspect_ratio(self) -> float:
        """Calculate aspect ratio."""
        return self.width / self.height

    def find_common_divisors(self, other: "Dimensions") -> list[int]:
        """Find common divisors with another Dimensions object."""
        divisors_width = self._get_divisors(min(self.width, other.width))
        divisors_height = self._get_divisors(min(self.height, other.height))
        return sorted(set(divisors_width) & set(divisors_height))

    @staticmethod
    def _get_divisors(n: int) -> list[int]:
        """Get all divisors of a number."""
        divisors = []
        for i in range(1, n + 1):
            if n % i == 0:
                divisors.append(i)
        return divisors
