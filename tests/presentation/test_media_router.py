"""Client uploads: staging browser-picked files where the backend can read them."""

from __future__ import annotations

import base64
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from ai_img2sketch.presentation.api.app import create_app
from ai_img2sketch.presentation.api.routers import media as media_router
from ai_img2sketch.presentation.api.settings import ApiSettings

_PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"payload"


@pytest.fixture()
def media_root(tmp_path: Path) -> Path:
    return tmp_path / "media"


@pytest.fixture()
def client(media_root: Path) -> Iterator[TestClient]:
    settings = ApiSettings(host="127.0.0.1", port=8736, media_dir=media_root)
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def _payload(
    *,
    content: bytes = _PNG_BYTES,
    filename: str = "photo.png",
    directory: str | None = None,
) -> dict[str, object]:
    body: dict[str, object] = {
        "filename": filename,
        "content_base64": base64.b64encode(content).decode("ascii"),
    }
    if directory is not None:
        body["directory"] = directory
    return body


def _stored_path(response: object) -> Path:
    body = cast(dict[str, Any], cast(TestClient, response).json())
    return Path(body["path"])


def test_stores_an_upload_and_returns_a_readable_path(client: TestClient, media_root: Path) -> None:
    response = client.post("/api/v1/media", json=_payload())

    assert response.status_code == 200
    stored = _stored_path(response)
    assert stored.is_absolute()
    assert stored.read_bytes() == _PNG_BYTES
    assert stored.parent == (media_root / "uploads").resolve()
    assert stored.name.startswith("photo-")
    assert stored.suffix == ".png"


def test_a_directory_bucket_keeps_a_batch_together(client: TestClient, media_root: Path) -> None:
    first = _stored_path(
        client.post("/api/v1/media", json=_payload(filename="a.png", directory="batch123"))
    )
    second = _stored_path(
        client.post("/api/v1/media", json=_payload(filename="b.png", directory="batch123"))
    )

    expected = (media_root / "uploads" / "batch123").resolve()
    assert first.parent == second.parent == expected
    assert first.name != second.name


def test_rejects_a_file_the_loader_could_not_open(client: TestClient) -> None:
    response = client.post("/api/v1/media", json=_payload(filename="notes.txt"))

    assert response.status_code == 422
    assert "Unsupported file type" in cast(dict[str, Any], response.json())["detail"]


def test_rejects_corrupt_base64(client: TestClient) -> None:
    response = client.post(
        "/api/v1/media", json={"filename": "x.png", "content_base64": "not base64!!"}
    )

    assert response.status_code == 422
    assert "base64" in cast(dict[str, Any], response.json())["detail"]


def test_rejects_an_oversized_upload(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(media_router, "MAX_UPLOAD_BYTES", 4)

    response = client.post("/api/v1/media", json=_payload())

    assert response.status_code == 422
    assert "too large" in cast(dict[str, Any], response.json())["detail"]


def test_rejects_a_bucket_name_that_escapes_the_store(client: TestClient) -> None:
    response = client.post("/api/v1/media", json=_payload(directory="../escape"))

    assert response.status_code == 422


def test_sanitizes_traversal_in_the_filename(client: TestClient, media_root: Path) -> None:
    response = client.post("/api/v1/media", json=_payload(filename="../../evil.png"))

    assert response.status_code == 200
    stored = _stored_path(response)
    assert stored.parent == (media_root / "uploads").resolve()
    assert ".." not in stored.name
