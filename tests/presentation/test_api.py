"""Web API tests: HTTP and SSE behaviour in front of the real use cases."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from ai_img2sketch.presentation.api.app import create_app
from ai_img2sketch.presentation.api.settings import ApiSettings

_FAST_SETTINGS = {"split_len": 16, "object_skip_rate": 14, "end_duration_sec": 0}


# Restrict all anyio-marked tests in this module to the asyncio backend.
# uvicorn calls asyncio.get_event_loop() internally and does not support trio.
@pytest.fixture()
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture()
def client() -> Iterator[TestClient]:
    """Test client on a fresh app (own event bus, CORS, lifespan)."""
    settings = ApiSettings(
        host="127.0.0.1",
        port=8735,
        cors_origins=["http://localhost:1420", "tauri://localhost"],
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def _write_image(path: Path) -> Path:
    """Write a small PNG with a dark circle so the sketch has work to do."""
    canvas = np.full((64, 64, 3), 240, dtype=np.uint8)
    cv2.circle(canvas, (32, 32), 16, (0, 0, 0), thickness=-1)
    written = cv2.imwrite(str(path), canvas)
    assert written is True
    return path


def test_health_reports_ok(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    payload = cast(dict[str, Any], response.json())
    assert payload["status"] == "ok"


def test_generate_sketch_writes_the_video(client: TestClient, tmp_path: Path) -> None:
    image = _write_image(tmp_path / "photo.png")
    output_dir = tmp_path / "videos"
    output_dir.mkdir()

    response = client.post(
        "/api/v1/sketches",
        json={
            "image_path": str(image),
            "output_dir": str(output_dir),
            "config": _FAST_SETTINGS,
        },
    )

    assert response.status_code == 200
    payload = cast(dict[str, Any], response.json())
    produced = Path(payload["output_path"])
    assert produced.name == "photo.mp4"
    assert produced.parent == output_dir
    assert produced.is_file()


def test_generate_sketch_returns_404_for_a_missing_image(client: TestClient) -> None:
    response = client.post("/api/v1/sketches", json={"image_path": "no/such/file.png"})

    assert response.status_code == 404
    # The detail echoes the (platform-formatted) path; match the basename only.
    assert "Image not found" in response.text
    assert "file.png" in response.text


def test_generate_batch_404_and_422_paths(client: TestClient, tmp_path: Path) -> None:
    missing = client.post("/api/v1/sketches/batch", json={"input_dir": str(tmp_path / "nope")})
    assert missing.status_code == 404

    empty = tmp_path / "empty"
    empty.mkdir()
    unusable = client.post("/api/v1/sketches/batch", json={"input_dir": str(empty)})
    assert unusable.status_code == 422
    assert "No supported images" in unusable.text


def test_generate_batch_generates_one_video_per_image(client: TestClient, tmp_path: Path) -> None:
    images = tmp_path / "images"
    images.mkdir()
    for name in ("one.png", "two.png"):
        _write_image(images / name)

    response = client.post(
        "/api/v1/sketches/batch",
        json={"input_dir": str(images), "config": _FAST_SETTINGS},
    )

    assert response.status_code == 200
    payload = cast(dict[str, Any], response.json())
    items = [item for item in payload["items"] if item["output_path"] is not None]
    assert len(items) == 2
    for item in items:
        assert Path(cast(str, item["output_path"])).is_file()


@pytest.mark.anyio
async def test_events_stream_sets_sse_headers() -> None:
    # ASGITransport buffers the whole body, so it cannot test SSE streaming.
    # A real HTTP server is needed.  We start uvicorn on an ephemeral port
    # inside an anyio task group and tear it down once the assertions are done.
    # Because the server and the test share the same event loop we can await
    # app.state.event_bus.close() to terminate the SSE generator naturally.
    import socket

    import anyio
    import httpx
    import uvicorn

    # Find a free port — bind, read it, then close before passing it to uvicorn.
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    settings = ApiSettings(
        host="127.0.0.1",
        port=port,
        cors_origins=["http://localhost:1420", "tauri://localhost"],
    )
    app = create_app(settings)

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="critical")
    server = uvicorn.Server(config)

    async with anyio.create_task_group() as tg:
        tg.start_soon(server.serve)

        # Wait until uvicorn is ready to accept connections.
        while not server.started:
            await anyio.sleep(0.05)

        async with (
            httpx.AsyncClient() as ac,
            ac.stream("GET", f"http://127.0.0.1:{port}/api/v1/events") as response,
        ):
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")

            head = ""
            async for chunk in response.aiter_text():
                head += chunk
                if ": connected" in head:
                    # Initial frames received — close the bus so the SSE
                    # generator yields the "close" frame and terminates.
                    await app.state.event_bus.close()
                if "event: close" in head:
                    break

            assert "retry: 5000" in head  # reconnect hint
            assert ": connected" in head  # initial ack frame

        server.should_exit = True


def test_cors_preflight_allows_tauri_origins(client: TestClient) -> None:
    response = client.options(
        "/api/v1/sketches",
        headers={
            "Origin": "http://localhost:1420",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:1420"


def test_cors_preflight_rejects_unknown_origins(client: TestClient) -> None:
    response = client.options(
        "/api/v1/sketches",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_default_origins_cover_the_tauri_webview() -> None:
    settings = ApiSettings()

    assert "tauri://localhost" in settings.cors_origins
    assert "http://tauri.localhost" in settings.cors_origins
