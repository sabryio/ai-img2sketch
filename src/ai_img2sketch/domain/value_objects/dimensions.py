"""Dimension value objects."""

from pydantic import BaseModel, Field, field_validator


class Dimensions(BaseModel):
    """Image or video dimensions with validation."""

    width: int = Field(gt=0, description="Width in pixels")
    height: int = Field(gt=0, description="Height in pixels")

    @field_validator("width", "height")
    @classmethod
    def validate_positive(cls, v: int) -> int:
        """Ensure dimensions are positive."""
        if v <= 0:
            raise ValueError("Dimensions must be positive")
        return v

    @property
    def aspect_ratio(self) -> float:
        """Calculate aspect ratio."""
        return self.width / self.height

    def is_divisible_by(self, divisor: int) -> bool:
        """Check if both dimensions are divisible by the given divisor."""
        return self.width % divisor == 0 and self.height % divisor == 0

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

    model_config = {"frozen": True}  # Make immutable
