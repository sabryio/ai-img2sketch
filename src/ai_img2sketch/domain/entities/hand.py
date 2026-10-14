"""Hand entity for animation."""

import numpy as np
import numpy.typing as npt
from pydantic import BaseModel, Field, field_validator

from ..value_objects.dimensions import Dimensions


class Hand(BaseModel):
    """Domain entity representing a drawing hand."""

    model_config = {"arbitrary_types_allowed": True}

    image_data: npt.NDArray[np.uint8] = Field(description="Hand image data")
    inverse_mask: npt.NDArray[np.float64] = Field(description="Inverse hand mask (0-1 range)")
    dimensions: Dimensions = Field(description="Hand image dimensions")

    @field_validator("inverse_mask")
    @classmethod
    def validate_mask(cls, v: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
        """Validate mask values are in the 0-1 range."""
        if not isinstance(v, np.ndarray):
            raise ValueError("Mask must be a numpy array")
        if v.min() < 0 or v.max() > 1:
            raise ValueError("Mask values must be in range [0, 1]")
        return v
