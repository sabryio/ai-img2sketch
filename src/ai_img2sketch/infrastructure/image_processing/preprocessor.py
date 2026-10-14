"""OpenCV-based image preprocessing adapter."""

from typing import cast

import cv2
import numpy as np
import numpy.typing as npt

from ...application.ports.image_preprocessor import ImagePreprocessor, PreprocessedImage
from ...domain.entities.image import Image
from ...domain.value_objects.dimensions import Dimensions


class OpenCVImagePreprocessor(ImagePreprocessor):
    """Preprocesses images using OpenCV."""

    def __init__(
        self,
        adaptive_thresh_block_size: int = 15,
        adaptive_thresh_c: int = 10,
    ) -> None:
        self.adaptive_thresh_block_size = adaptive_thresh_block_size
        self.adaptive_thresh_c = adaptive_thresh_c

    def preprocess(self, image: Image, target_dimensions: Dimensions) -> PreprocessedImage:
        """Resize and threshold an image, ready for sketch generation."""
        resized = cv2.resize(
            image.data,
            (target_dimensions.width, target_dimensions.height),
            interpolation=cv2.INTER_AREA,
        )

        if len(resized.shape) == 3:
            grayscale = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        else:
            grayscale = resized

        thresholded = cv2.adaptiveThreshold(
            grayscale,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            self.adaptive_thresh_block_size,
            self.adaptive_thresh_c,
        )

        # Ensure a 3-channel image so downstream frame drawing can use channels.
        original = resized if len(resized.shape) == 3 else cv2.cvtColor(resized, cv2.COLOR_GRAY2BGR)

        return PreprocessedImage(
            original=cast("npt.NDArray[np.uint8]", original),
            grayscale=cast("npt.NDArray[np.uint8]", grayscale),
            thresholded=cast("npt.NDArray[np.uint8]", thresholded),
            dimensions=target_dimensions,
        )
