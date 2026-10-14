"""Port for loading drawing-hand assets from disk."""

from pathlib import Path
from typing import Protocol

from ...domain.entities.hand import Hand


class HandLoader(Protocol):
    """Interface for loading a drawing hand and its mask from disk."""

    def load(self, hand_path: Path, mask_path: Path) -> Hand:
        """Load a hand image and mask from disk."""
        ...
