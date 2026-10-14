"""Object mask value object used for ordered, per-object drawing."""

import numpy as np
import numpy.typing as npt
from pydantic import BaseModel, Field, field_validator


class ObjectMask(BaseModel):
    """A named region to be drawn in a specific order and at a specific speed.

    ``region`` is a boolean raster (``True`` where the object is). A ``None``
    region marks the catch-all/"background" object: it owns every pixel that is
    not claimed by another mask. ``skip_rate`` overrides the global drawing skip
    rate for this object when set.
    """

    model_config = {"frozen": True, "arbitrary_types_allowed": True}

    name: str = Field(min_length=1, description="Human-readable object name")
    region: npt.NDArray[np.bool_] | None = Field(
        default=None, description="Boolean mask; None means catch-all/background"
    )
    skip_rate: int | None = Field(
        default=None, gt=0, description="Per-object draw skip rate; None uses the default"
    )

    @field_validator("region")
    @classmethod
    def validate_region(cls, v: npt.NDArray[np.bool_] | None) -> npt.NDArray[np.bool_] | None:
        """Validate that a region, when present, is a 2D array."""
        if v is None:
            return v
        if not isinstance(v, np.ndarray):
            raise ValueError("Object mask region must be a numpy array")
        if v.ndim != 2:
            raise ValueError("Object mask region must be 2D (height, width)")
        return v
