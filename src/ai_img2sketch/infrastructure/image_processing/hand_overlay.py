"""Service for overlaying hand animation on frames."""

import numpy as np
import numpy.typing as npt

from ...domain.entities.hand import Hand
from ...domain.value_objects.dimensions import Dimensions


class HandOverlayService:
    """Service to overlay hand image on drawing frames."""

    @staticmethod
    def overlay_hand(
        frame: npt.NDArray[np.uint8],
        hand: Hand,
        hand_x: int,
        hand_y: int,
        frame_dimensions: Dimensions,
    ) -> npt.NDArray[np.uint8]:
        """Overlay hand image on frame at specified coordinates."""
        # Calculate remaining space
        remaining_height = frame_dimensions.height - hand_y
        remaining_width = frame_dimensions.width - hand_x

        # Crop hand if it exceeds frame boundaries
        crop_height = min(hand.dimensions.height, remaining_height)
        crop_width = min(hand.dimensions.width, remaining_width)

        if crop_height <= 0 or crop_width <= 0:
            return frame

        # Crop hand and mask
        hand_cropped = hand.image_data[:crop_height, :crop_width]
        inverse_mask_cropped = hand.inverse_mask[:crop_height, :crop_width]

        # Get region of interest from frame
        roi = frame[hand_y : hand_y + crop_height, hand_x : hand_x + crop_width]

        # Apply mask to each channel
        for channel in range(3):
            roi[:, :, channel] = roi[:, :, channel] * inverse_mask_cropped

        # Add hand image
        frame[hand_y : hand_y + crop_height, hand_x : hand_x + crop_width] = roi + hand_cropped

        return frame

    @staticmethod
    def calculate_hand_position(drawing_x: int, drawing_y: int, split_len: int) -> tuple[int, int]:
        """Calculate hand position centered on drawing coordinates."""
        hand_x = drawing_x + split_len // 2
        hand_y = drawing_y + split_len // 2
        return hand_x, hand_y
