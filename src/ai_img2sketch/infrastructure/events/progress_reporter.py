"""Forwards generation progress onto the event loop as event frames.

Drawing happens in a worker thread (OpenCV and frame writing are blocking),
while the event bus lives on the event loop and is only safe to touch there.
This adapter is the single hop between the two: the use case calls it from the
thread, it hands each update to the loop, and the loop publishes it.

The use case reports one update per few percent, so the loop receives a handful
of callbacks per run rather than one per frame.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from contextlib import suppress

from ...application.ports.event_publisher import EventPublisher
from ...application.ports.progress_reporter import GenerationProgress


def progress_payload(progress: GenerationProgress) -> dict[str, object]:
    """Render one update as a payload, omitting what the run does not use."""
    data: dict[str, object] = {"percent": progress.percent}
    if progress.label:
        data["label"] = progress.label
    if progress.total_frames:
        data["frame"] = progress.frame
        data["total_frames"] = progress.total_frames
    if progress.item_index is not None:
        data["item_index"] = progress.item_index
    if progress.item_total is not None:
        data["item_total"] = progress.item_total
    if progress.item_name is not None:
        data["item_name"] = progress.item_name
    if progress.preview_path is not None:
        data["preview_path"] = progress.preview_path
    return data


class EventProgressReporter:
    """Publishes a run's progress as ``event`` frames on ``loop``.

    ``base`` carries the fields that identify the run — the same ones its
    lifecycle events use — so a client can attribute a progress frame without
    tracking state of its own.
    """

    def __init__(
        self,
        *,
        loop: asyncio.AbstractEventLoop,
        publisher: EventPublisher,
        event: str,
        base: Mapping[str, object] | None = None,
    ) -> None:
        self._loop = loop
        self._publisher = publisher
        self._event = event
        self._base = dict(base or {})
        #: Strong references so a scheduled publish cannot be collected while
        #: it is still queued on the loop.
        self._pending: set[asyncio.Task[None]] = set()

    def report(self, progress: GenerationProgress) -> None:
        """Queue one update for the loop. Never raises: progress is optional."""
        data = {**self._base, **progress_payload(progress)}
        # The loop is gone when the server shuts down mid-render. There is then
        # nobody left to tell, and raising here would abort a generation that has
        # already done its work.
        with suppress(RuntimeError):
            self._loop.call_soon_threadsafe(self._publish, data)

    def _publish(self, data: dict[str, object]) -> None:
        """Runs on the loop, which is the only place the bus may be touched."""
        task = self._loop.create_task(self._publisher.publish(self._event, data))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)
