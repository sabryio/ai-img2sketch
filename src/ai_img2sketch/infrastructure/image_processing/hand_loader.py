"""OpenCV-based drawing-hand loader adapter."""

from pathlib import Path
from typing import cast

import cv2
import numpy as np
import numpy.typing as npt

from ...application.ports.hand_loader import HandLoader
from ...domain.entities.hand import Hand
from ...domain.value_objects.dimensions import Dimensions


class OpenCVHandLoader(HandLoader):
    """Loads a drawing hand and mask from disk using OpenCV."""

    def load(self, hand_path: Path, mask_path: Path) -> Hand:
        """Load a hand image and its mask from disk, cropping to the mask bounds."""
        hand_img = cast(npt.NDArray[np.uint8] | None, cv2.imread(str(hand_path)))
        hand_mask = cast(
            npt.NDArray[np.uint8] | None,
            cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE),
        )

        if hand_img is None:
            raise FileNotFoundError(f"Hand image not found: {hand_path}")
        if hand_mask is None:
            raise FileNotFoundError(f"Hand mask not found: {mask_path}")

        top_left, bottom_right = self._get_mask_bounds(hand_mask)
        hand_img = hand_img[top_left[1] : bottom_right[1], top_left[0] : bottom_right[0]]
        hand_mask = hand_mask[top_left[1] : bottom_right[1], top_left[0] : bottom_right[0]]

        mask_normalized = (hand_mask / 255.0).astype(np.float64)
        inverse_mask = (1.0 - mask_normalized).astype(np.float64)

        # Zero out fully transparent regions of the hand image.
        hand_img[hand_mask == 0] = [0, 0, 0]

        height, width = hand_img.shape[:2]
        return Hand(
            image_data=hand_img,
            inverse_mask=inverse_mask,
            dimensions=Dimensions(width=width, height=height),
        )

    @staticmethod
    def _get_mask_bounds(
        mask: npt.NDArray[np.uint8],
    ) -> tuple[tuple[int, int], tuple[int, int]]:
        """Return the mask bounding box as ``(top_left, bottom_right)`` slices.

        Coordinates are half-open: ``bottom_right`` is exclusive, matching numpy
        slicing semantics, so the crop includes every foreground pixel.
        """
        ys, xs = np.where(mask == 255)
        if ys.size == 0:
            raise ValueError("Hand mask contains no foreground pixels")
        top = int(np.min(ys))
        left = int(np.min(xs))
        bottom = int(np.max(ys)) + 1
        right = int(np.max(xs)) + 1
        return (left, top), (right, bottom)
