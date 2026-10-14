"""Ports for writing videos."""

from typing import Protocol

import numpy as np
import numpy.typing as npt

from ...domain.entities.video import Video


class VideoWriter(Protocol):
    """Interface for writing video frames."""

    def write_frame(self, frame: npt.NDArray[np.uint8]) -> None:
        """Write a single frame to the video."""
        ...

    def release(self) -> None:
        """Release video writer resources."""
        ...


class VideoWriterFactory(Protocol):
    """Factory that creates a video writer for a given video."""

    def __call__(self, video: Video) -> VideoWriter:
        """Create a video writer for the given video."""
        ...
