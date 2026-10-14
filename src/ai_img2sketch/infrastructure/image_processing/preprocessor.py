"""Image preprocessing service."""

from typing import Protocol, cast

import cv2
import numpy as np
import numpy.typing as npt

from ...domain.entities.image import Image
from ...domain.value_objects.dimensions import Dimensions


class ImagePreprocessor(Protocol):
    """Interface for image preprocessing."""

    def preprocess(self, image: Image, target_dimensions: Dimensions) -> "PreprocessedImage":
        """Preprocess image for sketch generation."""
        ...


class PreprocessedImage:
    """Container for preprocessed image data."""

    def __init__(
        self,
        original: npt.NDArray[np.uint8],
        grayscale: npt.NDArray[np.uint8],
        thresholded: npt.NDArray[np.uint8],
        dimensions: Dimensions,
    ):
        self.original = original
        self.grayscale = grayscale
        self.thresholded = thresholded
        self.dimensions = dimensions


class OpenCVImagePreprocessor:
    """Image preprocessor using OpenCV."""

    def __init__(
        self,
        clahe_clip_limit: float = 2.0,
        clahe_tile_grid_size: tuple[int, int] = (3, 3),
        adaptive_thresh_block_size: int = 15,
        adaptive_thresh_c: int = 10,
    ):
        """Initialize preprocessor with configuration."""
        self.clahe_clip_limit = clahe_clip_limit
        self.clahe_tile_grid_size = clahe_tile_grid_size
        self.adaptive_thresh_block_size = adaptive_thresh_block_size
        self.adaptive_thresh_c = adaptive_thresh_c

    def preprocess(self, image: Image, target_dimensions: Dimensions) -> PreprocessedImage:
        """Preprocess image for sketch generation."""
        # Resize image
        resized_img = cast(
            npt.NDArray[np.uint8],
            cv2.resize(image.data, (target_dimensions.width, target_dimensions.height)),
        )

        # Convert to grayscale
        grayscale = cast(
            npt.NDArray[np.uint8],
            cv2.cvtColor(resized_img, cv2.COLOR_BGR2GRAY),
        )

        # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
        clahe = cv2.createCLAHE(
            clipLimit=self.clahe_clip_limit, tileGridSize=self.clahe_tile_grid_size
        )
        # Apply CLAHE for enhanced contrast (not used in current implementation)
        _ = clahe.apply(grayscale)

        # Apply adaptive thresholding
        thresholded = cast(
            npt.NDArray[np.uint8],
            cv2.adaptiveThreshold(
                grayscale,
                255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                self.adaptive_thresh_block_size,
                self.adaptive_thresh_c,
            ),
        )

        return PreprocessedImage(
            original=resized_img,
            grayscale=grayscale,
            thresholded=thresholded,
            dimensions=target_dimensions,
        )
