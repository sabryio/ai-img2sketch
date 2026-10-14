"""Video writing service."""

from typing import Protocol

import cv2
import numpy.typing as npt

from ...domain.entities.video import Video


class VideoWriterProtocol(Protocol):
    """Protocol for video writers."""

    def write_frame(self, frame: npt.NDArray) -> None:
        """Write a single frame to video."""
        ...

    def release(self) -> None:
        """Release video writer resources."""
        ...


class OpenCVVideoWriter:
    """Video writer implementation using OpenCV."""

    def __init__(self, video: Video):
        """Initialize video writer."""
        self.video = video
        self._writer: cv2.VideoWriter | None = None
        self._initialize_writer()

    def _initialize_writer(self) -> None:
        """Initialize OpenCV VideoWriter."""
        # Ensure output directory exists
        self.video.output_path.parent.mkdir(parents=True, exist_ok=True)

        # Create video writer
        fourcc = cv2.VideoWriter.fourcc("m", "p", "4", "v")
        self._writer = cv2.VideoWriter(
            str(self.video.output_path),
            fourcc,
            self.video.config.frame_rate,
            (self.video.dimensions.width, self.video.dimensions.height),
        )

        if not self._writer.isOpened():
            raise RuntimeError(f"Failed to open video writer for {self.video.output_path}")

    def write_frame(self, frame: npt.NDArray) -> None:
        """Write a single frame to video."""
        if self._writer is None:
            raise RuntimeError("Video writer not initialized")
        self._writer.write(frame)

    def release(self) -> None:
        """Release video writer resources."""
        if self._writer is not None:
            self._writer.release()
            self._writer = None

    def __enter__(self) -> "OpenCVVideoWriter":
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """Context manager exit."""
        self.release()
