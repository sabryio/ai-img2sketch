"""OpenCV-based video writer adapter."""

import cv2
import numpy as np
import numpy.typing as npt

from ...application.ports.video_writer import VideoWriter
from ...domain.entities.video import Video


class OpenCVVideoWriter(VideoWriter):
    """Writes video frames to disk using OpenCV."""

    def __init__(self, video: Video) -> None:
        self.video = video
        self._writer: cv2.VideoWriter | None = None
        self._initialize_writer()

    def _initialize_writer(self) -> None:
        """Create the output directory and open the underlying OpenCV writer."""
        self.video.output_path.parent.mkdir(parents=True, exist_ok=True)

        fourcc = cv2.VideoWriter.fourcc("m", "p", "4", "v")
        writer = cv2.VideoWriter(
            str(self.video.output_path),
            fourcc,
            self.video.config.frame_rate,
            (self.video.dimensions.width, self.video.dimensions.height),
        )
        if not writer.isOpened():
            raise RuntimeError(f"Failed to open video writer for: {self.video.output_path}")
        self._writer = writer

    def write_frame(self, frame: npt.NDArray[np.uint8]) -> None:
        """Write a single frame to the video."""
        if self._writer is None:
            raise RuntimeError("Video writer is not initialized")
        self._writer.write(frame)

    def release(self) -> None:
        """Release the underlying OpenCV writer."""
        if self._writer is not None:
            self._writer.release()
            self._writer = None


def create_opencv_video_writer(video: Video) -> OpenCVVideoWriter:
    """Create an OpenCV-backed video writer (implements ``VideoWriterFactory``)."""
    return OpenCVVideoWriter(video)
