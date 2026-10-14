"""Port for preprocessing images for sketch generation."""

from dataclasses import dataclass
from typing import Protocol

import numpy as np
import numpy.typing as npt

from ...domain.entities.image import Image
from ...domain.value_objects.dimensions import Dimensions


@dataclass(frozen=True, slots=True)
class PreprocessedImage:
    """Result of preprocessing an image for sketch generation."""

    original: npt.NDArray[np.uint8]
    grayscale: npt.NDArray[np.uint8]
    thresholded: npt.NDArray[np.uint8]
    dimensions: Dimensions


class ImagePreprocessor(Protocol):
    """Interface for image preprocessing."""

    def preprocess(self, image: Image, target_dimensions: Dimensions) -> PreprocessedImage:
        """Preprocess an image for sketch generation."""
        ...
