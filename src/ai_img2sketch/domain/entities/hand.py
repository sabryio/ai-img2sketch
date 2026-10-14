"""Hand entity for animation."""

from pathlib import Path
from typing import cast

import numpy as np
import numpy.typing as npt
from pydantic import BaseModel, Field, field_validator

from ..value_objects.dimensions import Dimensions


class Hand(BaseModel):
    """Domain entity representing a drawing hand."""

    image_data: npt.NDArray[np.uint8] = Field(description="Hand image data")
    mask: npt.NDArray[np.float64] = Field(description="Hand mask (0-1 range)")
    inverse_mask: npt.NDArray[np.float64] = Field(description="Inverse hand mask")
    dimensions: Dimensions = Field(description="Hand image dimensions")
    source_path: Path = Field(description="Path to hand image")
    mask_path: Path = Field(description="Path to hand mask")

    @field_validator("mask", "inverse_mask")
    @classmethod
    def validate_mask(cls, v: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
        """Validate mask values are in 0-1 range."""
        if not isinstance(v, np.ndarray):
            raise ValueError("Mask must be a numpy array")
        if v.min() < 0 or v.max() > 1:
            raise ValueError("Mask values must be in range [0, 1]")
        return v

    @classmethod
    def load(cls, hand_path: Path, mask_path: Path) -> "Hand":
        """Load hand image and mask from files."""
        import cv2

        # Load images
        hand_img = cv2.imread(str(hand_path))
        hand_mask = cast(
            npt.NDArray[np.uint8] | None,
            cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE),
        )

        if hand_img is None:
            raise FileNotFoundError(f"Hand image not found: {hand_path}")
        if hand_mask is None:
            raise FileNotFoundError(f"Hand mask not found: {mask_path}")

        # Get extreme coordinates and crop
        top_left, bottom_right = cls._get_extreme_coordinates(hand_mask)
        hand_img = hand_img[top_left[1] : bottom_right[1], top_left[0] : bottom_right[0]]
        hand_mask = hand_mask[top_left[1] : bottom_right[1], top_left[0] : bottom_right[0]]

        # Normalize masks to 0-1 range
        mask_normalized = (hand_mask / 255.0).astype(np.float64)
        inverse_mask = (1.0 - mask_normalized).astype(np.float64)

        # Make background black
        hand_img[hand_mask == 0] = [0, 0, 0]

        # Get dimensions
        height, width = hand_img.shape[:2]
        dimensions = Dimensions(width=width, height=height)

        return cls(
            image_data=hand_img,
            mask=mask_normalized,
            inverse_mask=inverse_mask,
            dimensions=dimensions,
            source_path=hand_path,
            mask_path=mask_path,
        )

    @staticmethod
    def _get_extreme_coordinates(
        mask: npt.NDArray[np.uint8],
    ) -> tuple[tuple[int, int], tuple[int, int]]:
        """Find bounding box of mask."""
        indices = np.where(mask == 255)
        x = indices[1]
        y = indices[0]
        top_left = (int(np.min(x)), int(np.min(y)))
        bottom_right = (int(np.max(x)), int(np.max(y)))
        return top_left, bottom_right

    model_config = {"arbitrary_types_allowed": True}
