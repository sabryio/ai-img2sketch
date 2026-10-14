"""Port for loading source images from disk."""

from pathlib import Path
from typing import Protocol

from ...domain.entities.image import Image


class ImageLoader(Protocol):
    """Interface for loading images from disk."""

    def load(self, path: Path) -> Image:
        """Load an image from disk."""
        ...
