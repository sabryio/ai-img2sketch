"""Image entity."""

from pathlib import Path

import numpy as np
import numpy.typing as npt
from pydantic import BaseModel, Field, field_validator

from ..value_objects.dimensions import Dimensions


class Image(BaseModel):
    """Domain entity representing an image."""

    model_config = {"arbitrary_types_allowed": True}

    data: npt.NDArray[np.uint8] = Field(description="Image data as numpy array")
    dimensions: Dimensions = Field(description="Image dimensions")
    path: Path | None = Field(default=None, description="Original image path")

    @field_validator("data")
    @classmethod
    def validate_image_data(cls, v: npt.NDArray[np.uint8]) -> npt.NDArray[np.uint8]:
        """Validate image data."""
        if not isinstance(v, np.ndarray):
            raise ValueError("Image data must be a numpy array")
        if v.ndim not in [2, 3]:
            raise ValueError("Image must be 2D (grayscale) or 3D (color)")
        return v

    @classmethod
    def from_array(cls, data: npt.NDArray[np.uint8], path: Path | None = None) -> "Image":
        """Create an Image from a numpy array."""
        height, width = data.shape[:2]
        dimensions = Dimensions(width=width, height=height)
        return cls(data=data, dimensions=dimensions, path=path)
