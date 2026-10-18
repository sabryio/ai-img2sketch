"""Progress frames published while a render runs.

A wiring test: the router has to hand the use case a reporter, and that reporter
has to publish ``sketch.progress`` / ``batch.progress`` frames carrying the same
fields that identify the run, so a client can attribute a bar to a request.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import cast

import cv2
import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from ai_img2sketch.presentation.api.routers import create_sketches_router

#: Small, quick renders: the progress *channel* is what is under test.
_FAST_SETTINGS = {
    "split_len": 16,
    "object_skip_rate": 4,
    "end_duration_sec": 0,
    "black_pixel_threshold": 20,
}


class RecordingPublisher:
    """Keeps every published event, so a test can read the whole stream."""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, object]]] = []

    async def publish(self, event: str, data: Mapping[str, object]) -> None:
        self.events.append((event, dict(data)))


@pytest.fixture()
def publisher() -> RecordingPublisher:
    return RecordingPublisher()


@pytest.fixture()
def client(publisher: RecordingPublisher) -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(create_sketches_router(publisher=publisher), prefix="/api/v1")
    with TestClient(app) as test_client:
        yield test_client


def _write_image(path: Path) -> Path:
    """Write a small PNG with a dark circle so the sketch has work to do."""
    canvas = np.full((64, 64, 3), 240, dtype=np.uint8)
    cv2.circle(canvas, (32, 32), 16, (0, 0, 0), thickness=-1)
    assert cv2.imwrite(str(path), canvas) is True
    return path


def _progress(publisher: RecordingPublisher, event: str) -> list[dict[str, object]]:
    return [data for name, data in publisher.events if name == event]


def test_sketch_progress_is_published_between_the_lifecycle_events(
    client: TestClient, publisher: RecordingPublisher, tmp_path: Path
) -> None:
    image = _write_image(tmp_path / "photo.png")

    response = client.post(
        "/api/v1/sketches",
        json={"image_path": str(image), "config": _FAST_SETTINGS},
    )

    assert response.status_code == 200
    names = [name for name, _ in publisher.events]
    assert names[0] == "sketch.started"
    assert names[-1] == "sketch.completed"

    progress = _progress(publisher, "sketch.progress")
    assert progress, "a render must report progress"
    percents = [cast(int, data["percent"]) for data in progress]
    assert percents == sorted(percents)
    assert percents[-1] == 100

    for data in progress:
        # Every frame identifies the run it belongs to.
        assert data["image"] == str(image)
        assert data["output_path"] == str(tmp_path / "photo.mp4")
        assert cast(int, data["total_frames"]) > 0


def test_batch_progress_carries_the_position_in_the_run(
    client: TestClient, publisher: RecordingPublisher, tmp_path: Path
) -> None:
    images = tmp_path / "images"
    images.mkdir()
    for name in ("one.png", "two.png"):
        _write_image(images / name)

    response = client.post(
        "/api/v1/sketches/batch",
        json={"input_dir": str(images), "config": _FAST_SETTINGS},
    )

    assert response.status_code == 200
    progress = _progress(publisher, "batch.progress")
    assert progress, "a batch must report progress"

    percents = [cast(int, data["percent"]) for data in progress]
    assert percents == sorted(percents)
    assert percents[-1] == 100

    for data in progress:
        assert data["input_dir"] == str(images)
        assert data["item_total"] == 2
        assert cast(int, data["item_index"]) in (1, 2)
        assert cast(str, data["item_name"]).endswith(".png")

    # Both images are announced, so the bar is never stuck on the first one.
    assert {cast(int, data["item_index"]) for data in progress} == {1, 2}
