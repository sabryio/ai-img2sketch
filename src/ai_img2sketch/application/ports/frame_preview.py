"""Port for showing the frame a render is drawing, while it draws it.

A render already reports progress a handful of times per run; at exactly that
moment it is holding the frame it just wrote, so this port turns that frame into
a still a client can display. It is called from the render's worker thread, at
most once per progress report (a handful per run, never once per frame), and it
must never raise: a still that cannot be written costs a preview, not a render.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np
import numpy.typing as npt


@runtime_checkable
class FramePreviewPublisher(Protocol):
    """Stores a still of one drawn frame and returns where it went."""

    def publish(self, frame: npt.NDArray[np.uint8]) -> str | None:
        """Store a still of one drawn frame; return its path, or ``None``."""
        ...
