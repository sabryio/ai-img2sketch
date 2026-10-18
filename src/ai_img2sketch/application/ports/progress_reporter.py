"""Port for reporting how far a generation has got.

Generation is CPU-bound and runs to completion in a worker thread, so a caller
cannot await it. Progress is pushed instead: the use case reports as it draws,
and whoever wired it decides what that becomes — an SSE frame, a log line, or
nothing at all (:class:`NullProgressReporter`).

Implementations are called from that worker thread, so ``report`` must be safe
to call there and must never raise: progress is information, not control flow,
and a listener that fails must not abort a render.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class GenerationProgress:
    """How far one generation has got.

    ``percent`` always describes the whole request. Inside a batch that means an
    image's share of the run, so the number only ever moves forward.
    """

    percent: int
    """Completion of the request, 0-100."""

    frame: int = 0
    """Frames written for the current image."""

    total_frames: int = 0
    """Frames the current image will write."""

    label: str = ""
    """What is being drawn right now (a drawing group's label)."""

    item_index: int | None = None
    """1-based position in a batch, or ``None`` for a single request."""

    item_total: int | None = None
    """How many images the batch will process."""

    item_name: str | None = None
    """File name of the image being drawn."""

    preview_path: str | None = None
    """A still of the frame just drawn, or ``None``.

    Inside a volume the API serves, and deleted when the run ends: it exists so a
    client can watch the drawing, not as an artifact to keep.
    """


@runtime_checkable
class ProgressReporter(Protocol):
    """Receives updates while a generation is running."""

    def report(self, progress: GenerationProgress) -> None:
        """Record one update. Must not raise; must tolerate any thread."""
        ...


class NullProgressReporter:
    """The default when nobody is listening (CLI runs, tests)."""

    def report(self, progress: GenerationProgress) -> None:
        """Discard the update."""
