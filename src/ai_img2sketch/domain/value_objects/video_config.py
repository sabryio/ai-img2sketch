"""Video configuration value objects."""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from .dimensions import Dimensions


class VideoConfig(BaseModel):
    """Configuration for video generation."""

    frame_rate: int = Field(default=25, ge=1, le=120, description="Video frame rate (fps)")
    split_len: int = Field(default=10, ge=1, le=100, description="Grid split length")
    object_skip_rate: int = Field(
        default=8, ge=1, le=100, description="Skip rate for object drawing"
    )
    bg_object_skip_rate: int = Field(
        default=14, ge=1, le=100, description="Skip rate for background drawing"
    )
    end_duration_sec: int = Field(
        default=2, ge=0, le=10, description="Duration to show final colored image"
    )
    black_pixel_threshold: int = Field(
        default=10, ge=0, le=255, description="Threshold for black pixel detection"
    )

    def validate_split_compatibility(self, dimensions: Dimensions) -> bool:
        """Check if split_len is compatible with given dimensions."""
        return dimensions.is_divisible_by(self.split_len)

    model_config = {"frozen": True}
