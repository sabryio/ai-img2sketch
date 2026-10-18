"""PyAV-based video writer adapter.

The result is watched in this app before it is downloaded, so the file has to be
in a codec a browser and a desktop webview can decode. OpenCV's bundled FFmpeg
ships exactly one MP4 encoder — ``mp4v``, MPEG-4 Part 2 — and neither of them
decodes it: the video could be rendered and handed over, but never played in the
app that made it. PyAV bundles FFmpeg with libx264, so frames are written as
H.264 in ``yuv420p``, which every browser, player, editor and platform accepts.

Three consequences of that choice live here rather than in the drawing pipeline:

- H.264 in 4:2:0 needs even dimensions, so a frame whose width or height is odd
  is padded by one replicated pixel. The drawing algorithm sizes the canvas to a
  multiple of the split length, which can be odd, so this is reachable — but only
  odd images pay for it, and one edge pixel is invisible.
- The constant-rate factor is chosen for line art: hard black edges on paper stay
  crisp, and a sketch lands far smaller than the same drawing in ``mp4v``.
- ``+faststart`` moves the index to the front of the file, so a client starts
  watching without waiting to hold the whole video.
"""

from __future__ import annotations

from fractions import Fraction

import av
import numpy as np
import numpy.typing as npt

from ...application.ports.video_writer import VideoWriter
from ...domain.entities.video import Video
from ...domain.value_objects.dimensions import Dimensions

#: Visually lossless for line art while keeping a sketch a fraction of the size.
_CRF = "18"

#: Encoding stays a fraction of the drawing time, which dominates a render.
_PRESET = "veryfast"


class PyAVVideoWriter(VideoWriter):
    """Writes video frames to disk as H.264 using PyAV."""

    def __init__(self, video: Video) -> None:
        self.video = video
        self._container: av.container.OutputContainer | None = None
        self._stream: av.video.stream.VideoStream | None = None
        self._size = _even_size(video.dimensions)
        self._initialize_writer()

    def _initialize_writer(self) -> None:
        """Create the output directory and open the muxer and encoder."""
        output_path = self.video.output_path
        output_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            container = av.open(
                str(output_path),
                mode="w",
                options={"movflags": "+faststart"},
            )
            stream = container.add_stream(
                "libx264",
                rate=Fraction(self.video.config.frame_rate),
                options={"crf": _CRF, "preset": _PRESET},
            )
            # The stream is sized to what is actually encoded: an odd canvas is
            # padded, and the encoder and the frames have to agree on the result.
            stream.width, stream.height = self._size
            stream.pix_fmt = "yuv420p"
        except av.error.FFmpegError as error:
            raise RuntimeError(f"Failed to open video writer for: {output_path}") from error

        self._container = container
        self._stream = stream

    def write_frame(self, frame: npt.NDArray[np.uint8]) -> None:
        """Write a single frame to the video."""
        stream, container = self._stream, self._container
        if stream is None or container is None:
            raise RuntimeError("Video writer is not initialized")

        video_frame = av.VideoFrame.from_ndarray(_pad_to(frame, self._size), format="bgr24")
        for packet in stream.encode(video_frame):
            container.mux(packet)

    def release(self) -> None:
        """Flush the encoder and finish the file."""
        stream, container = self._stream, self._container
        self._stream = None
        self._container = None
        if stream is None or container is None:
            return

        # Encoding buffers frames, so the tail has to be drained before the file
        # is closed or the last frames never reach it.
        for packet in stream.encode():
            container.mux(packet)
        container.close()


def _even_size(dimensions: Dimensions) -> tuple[int, int]:
    """Return the size H.264 in 4:2:0 can encode, rounding each side up."""
    return (dimensions.width + dimensions.width % 2, dimensions.height + dimensions.height % 2)


def _pad_to(
    frame: npt.NDArray[np.uint8],
    size: tuple[int, int],
) -> npt.NDArray[np.uint8]:
    """Return ``frame`` at ``size``, extending the edges if it is smaller.

    Only ever by the single pixel an odd canvas is short of an even one, and the
    edge it copies comes from the drawing itself, so nothing is added to the
    picture that was not already at its border.
    """
    width, height = size
    pad_width = max(0, width - frame.shape[1])
    pad_height = max(0, height - frame.shape[0])
    if pad_width == 0 and pad_height == 0:
        return frame

    padded: npt.NDArray[np.uint8] = np.pad(
        frame,
        ((0, pad_height), (0, pad_width), (0, 0)),
        mode="edge",
    )
    return padded


def create_pyav_video_writer(video: Video) -> PyAVVideoWriter:
    """Create a PyAV-backed video writer (implements ``VideoWriterFactory``)."""
    return PyAVVideoWriter(video)
