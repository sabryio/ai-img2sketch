"""Video entity."""

from pathlib import Path

from pydantic import BaseModel, Field

from ..value_objects.dimensions import Dimensions
from ..value_objects.video_config import VideoConfig


class Video(BaseModel):
    """Domain entity representing a video to be written."""

    model_config = {"frozen": True}

    output_path: Path = Field(description="Output video file path")
    dimensions: Dimensions = Field(description="Video dimensions")
    config: VideoConfig = Field(description="Video configuration")
