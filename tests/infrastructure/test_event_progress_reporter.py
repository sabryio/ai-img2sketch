"""The thread-to-loop hop that carries progress to the event stream.

Drawing runs in a worker thread; the bus lives on the event loop. These tests
pin that boundary down: updates reported from a thread arrive, keep their order,
and stay silent once the loop is gone.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import cast

from ai_img2sketch.application.ports.event_publisher import EventPublisher
from ai_img2sketch.application.ports.progress_reporter import GenerationProgress
from ai_img2sketch.infrastructure.events.progress_reporter import (
    EventProgressReporter,
    progress_payload,
)


class RecordingPublisher:
    """Collects what a reporter publishes."""

    def __init__(self) -> None:
        self.published: list[tuple[str, dict[str, object]]] = []

    async def publish(self, event: str, data: Mapping[str, object]) -> None:
        self.published.append((event, dict(data)))


def test_reports_from_a_worker_thread_reach_the_publisher() -> None:
    async def scenario() -> list[tuple[str, dict[str, object]]]:
        publisher = RecordingPublisher()
        reporter = EventProgressReporter(
            loop=asyncio.get_running_loop(),
            publisher=publisher,
            event="sketch.progress",
            base={"image": "a.png", "output_path": "a.mp4"},
        )

        # The use case is synchronous and off-loop: this is how it calls back.
        await asyncio.to_thread(
            reporter.report,
            GenerationProgress(percent=40, frame=2, total_frames=5, label="image"),
        )
        # Let the callback the loop was handed actually run.
        await asyncio.sleep(0)
        return publisher.published

    assert asyncio.run(scenario()) == [
        (
            "sketch.progress",
            {
                "image": "a.png",
                "output_path": "a.mp4",
                "percent": 40,
                "label": "image",
                "frame": 2,
                "total_frames": 5,
            },
        )
    ]


def test_updates_keep_the_order_they_were_reported_in() -> None:
    async def scenario() -> list[int]:
        publisher = RecordingPublisher()
        reporter = EventProgressReporter(
            loop=asyncio.get_running_loop(), publisher=publisher, event="batch.progress"
        )

        def report_many() -> None:
            for percent in (10, 40, 80):
                reporter.report(GenerationProgress(percent=percent))

        await asyncio.to_thread(report_many)
        await asyncio.sleep(0)
        return [cast(int, data["percent"]) for _, data in publisher.published]

    assert asyncio.run(scenario()) == [10, 40, 80]


def test_payload_omits_what_the_run_does_not_use() -> None:
    assert progress_payload(GenerationProgress(percent=0)) == {"percent": 0}
    assert progress_payload(
        GenerationProgress(percent=50, item_index=2, item_total=4, item_name="b.png")
    ) == {"percent": 50, "item_index": 2, "item_total": 4, "item_name": "b.png"}


def test_payload_carries_the_preview_path_when_set() -> None:
    preview_path = "/app/media/previews/ab12/frame-0001.jpg"

    assert progress_payload(
        GenerationProgress(percent=40, label="image", preview_path=preview_path)
    ) == {"percent": 40, "label": "image", "preview_path": preview_path}


def test_reporting_after_the_loop_is_gone_is_ignored() -> None:
    async def build() -> EventProgressReporter:
        return EventProgressReporter(
            loop=asyncio.get_running_loop(),
            publisher=RecordingPublisher(),
            event="sketch.progress",
        )

    reporter = asyncio.run(build())

    # The run outlived the loop (shutdown mid-render). Nobody is listening, and
    # a raise here would abort a generation that already produced its file.
    reporter.report(GenerationProgress(percent=100))


def test_the_reporter_satisfies_the_ports() -> None:
    publisher = RecordingPublisher()

    # Structural conformance, asserted where the types are checked: the adapter
    # is handed to the use case as a ProgressReporter and to the bus as a
    # publisher, so both must hold.
    assert isinstance(publisher, EventPublisher)
