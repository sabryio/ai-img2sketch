"""Image entity."""

from pathlib import Path
from typing import cast

import numpy as np
import numpy.typing as npt
from pydantic import BaseModel, Field, field_validator

from ..value_objects.dimensions import Dimensions


class Image(BaseModel):
    """Domain entity representing an image."""

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
        """Create Image from numpy array."""
        height, width = data.shape[:2]
        dimensions = Dimensions(width=width, height=height)
        return cls(data=data, dimensions=dimensions, path=path)

    def to_grayscale(self) -> npt.NDArray[np.uint8]:
        """Convert image to grayscale if it's color."""
        if self.data.ndim == 2:
            return self.data
        import cv2

        return cast(npt.NDArray[np.uint8], cv2.cvtColor(self.data, cv2.COLOR_BGR2GRAY))

    def resize(self, target_dimensions: Dimensions) -> "Image":
        """Resize image to target dimensions."""
        import cv2

        resized_data = cast(
            npt.NDArray[np.uint8],
            cv2.resize(self.data, (target_dimensions.width, target_dimensions.height)),
        )
        return Image.from_array(resized_data, self.path)

    model_config = {"arbitrary_types_allowed": True}
