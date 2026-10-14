"""Video entity."""

from pathlib import Path

from pydantic import BaseModel, Field

from ..value_objects.dimensions import Dimensions
from ..value_objects.video_config import VideoConfig


class Video(BaseModel):
    """Domain entity representing a video."""

    output_path: Path = Field(description="Output video file path")
    dimensions: Dimensions = Field(description="Video dimensions")
    config: VideoConfig = Field(description="Video configuration")
    frame_count: int = Field(default=0, ge=0, description="Number of frames")
    is_complete: bool = Field(default=False, description="Whether video is complete")

    def mark_complete(self) -> "Video":
        """Mark video as complete."""
        return self.model_copy(update={"is_complete": True})

    def increment_frame_count(self, count: int = 1) -> "Video":
        """Increment frame count."""
        return self.model_copy(update={"frame_count": self.frame_count + count})

    model_config = {"frozen": False}
