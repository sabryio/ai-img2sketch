"""Writes stills of the frame a render is drawing into the served media volume.

A preview is scratch for the duration of one render: it is written while the
video is drawn, served to the client from the media volume the API already
serves downloads from, and removed when the run ends. It is never kept — the
video is the artifact, the still only lets a client watch the drawing happen.

One store exists per run and owns one directory per run
(``<root>/previews/<run>/frame-0001.jpg``), so cleanup can drop the whole run
without touching another one's stills.
"""

from __future__ import annotations

import logging
import shutil
import uuid
from contextlib import suppress
from pathlib import Path
from typing import cast

import cv2
import numpy as np
import numpy.typing as npt

#: Stills live beside uploads in the media volume, under their own bucket.
PREVIEW_SUBDIR = "previews"

logger = logging.getLogger(__name__)


class FramePreviewStore:
    """Stores downscaled JPEG stills of drawn frames for the life of one run."""

    def __init__(self, root: Path, *, max_width: int = 960, quality: int = 82) -> None:
        self._root = root
        self._run_dir = root / PREVIEW_SUBDIR / uuid.uuid4().hex
        self._max_width = max_width
        self._quality = quality
        self._frame = 0

    def publish(self, frame: npt.NDArray[np.uint8]) -> str | None:
        """Write a still of ``frame``; return its path, or ``None``.

        Never raises: a still that cannot be written costs a preview, not the
        render that is producing it.
        """
        self._frame += 1
        try:
            still = self._downscale(frame)
            self._run_dir.mkdir(parents=True, exist_ok=True)
            path = self._run_dir / f"frame-{self._frame:04d}.jpg"
            written = cv2.imwrite(str(path), still, [cv2.IMWRITE_JPEG_QUALITY, self._quality])
            if not written:
                logger.warning("Could not write preview still: %s", path)
                return None
            return str(path.resolve())
        except Exception:  # a preview must never break a render
            logger.warning("Failed to publish a frame preview", exc_info=True)
            return None

    def cleanup(self) -> None:
        """Remove this run's stills, leaving nothing behind in the volume.

        The ``previews`` parent goes too, but only once it is empty, so a
        concurrent run's stills are never disturbed.
        """
        shutil.rmtree(self._run_dir, ignore_errors=True)
        with suppress(OSError):
            self._run_dir.parent.rmdir()

    def _downscale(self, frame: npt.NDArray[np.uint8]) -> npt.NDArray[np.uint8]:
        """Fit ``frame`` to ``max_width``, keeping its aspect ratio.

        A frame at or below the limit is written as-is: upscaling would only
        spend bytes inventing pixels the client does not need.
        """
        height, width = frame.shape[:2]
        if width <= self._max_width:
            return frame
        scaled_height = max(1, round(height * self._max_width / width))
        return cast(
            "npt.NDArray[np.uint8]",
            cv2.resize(frame, (self._max_width, scaled_height), interpolation=cv2.INTER_AREA),
        )
