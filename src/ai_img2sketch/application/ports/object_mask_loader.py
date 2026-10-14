"""Port for loading ordered object masks."""

from pathlib import Path
from typing import Protocol

from ...domain.value_objects.dimensions import Dimensions
from ...domain.value_objects.object_mask import ObjectMask


class ObjectMaskLoader(Protocol):
    """Interface for loading ordered object masks from disk.

    Implementations return masks in drawing order. Masks are authored in the
    source image's coordinate space and must be scaled to ``target_dimensions``
    (the source dimensions rounded to a multiple of the grid size).
    """

    def load(
        self,
        mask_path: Path,
        source_dimensions: Dimensions,
        target_dimensions: Dimensions,
    ) -> list[ObjectMask]:
        """Load object masks from ``mask_path``, sized to ``target_dimensions``."""
        ...
