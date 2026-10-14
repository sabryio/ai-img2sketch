"""Video configuration value object."""

from pydantic import BaseModel, Field


class VideoConfig(BaseModel):
    """Configuration for video generation."""

    model_config = {"frozen": True}

    frame_rate: int = Field(default=25, ge=1, le=120, description="Video frame rate (fps)")
    split_len: int = Field(default=10, ge=1, le=100, description="Grid split length")
    object_skip_rate: int = Field(default=8, ge=1, le=100, description="Skip rate for drawing")
    end_duration_sec: int = Field(
        default=2, ge=0, le=10, description="Duration to show final colored image"
    )
    black_pixel_threshold: int = Field(
        default=10, ge=0, le=255, description="Threshold for black pixel detection"
    )
