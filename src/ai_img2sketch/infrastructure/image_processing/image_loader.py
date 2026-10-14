"""OpenCV-based image loader adapter."""

from pathlib import Path
from typing import cast

import cv2
import numpy as np
import numpy.typing as npt

from ...application.ports.image_loader import ImageLoader
from ...domain.entities.image import Image


class OpenCVImageLoader(ImageLoader):
    """Loads images from disk using OpenCV."""

    def load(self, path: Path) -> Image:
        """Load an image from disk using OpenCV."""
        if not path.exists():
            raise FileNotFoundError(f"Image not found: {path}")

        data = cast(npt.NDArray[np.uint8] | None, cv2.imread(str(path)))
        if data is None:
            raise ValueError(f"Failed to load image: {path}")

        return Image.from_array(data, path)
