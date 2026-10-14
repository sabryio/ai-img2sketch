"""Port for generating a single sketch video."""

from pathlib import Path
from typing import Protocol

from ...domain.entities.image import Image
from ...domain.value_objects.video_config import VideoConfig


class SketchVideoGenerator(Protocol):
    """Interface for producing one sketch video from one image.

    ``GenerateSketchVideoUseCase`` satisfies this contract; the batch use case
    depends on the abstraction so it can be tested with a lightweight fake.
    """

    def execute(
        self,
        image: Image,
        config: VideoConfig,
        *,
        output_path: Path,
        object_mask_path: Path | None = None,
    ) -> Path:
        """Generate and return the video path for ``image``."""
        ...
