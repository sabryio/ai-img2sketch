"""Downloading what the backend produced — and only that."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from ai_img2sketch.presentation.api.app import create_app
from ai_img2sketch.presentation.api.settings import ApiSettings

_VIDEO = b"\x00\x00\x00\x18ftypmp42" + b"frames"


@pytest.fixture()
def media_root(tmp_path: Path) -> Path:
    """A video written beside its image, which is the API's default output."""
    root = tmp_path / "media"
    (root / "sketches").mkdir(parents=True)
    (root / "sketches" / "portrait.mp4").write_bytes(_VIDEO)
    return root


@pytest.fixture()
def output_root(tmp_path: Path) -> Path:
    root = tmp_path / "output"
    root.mkdir()
    (root / "batch.mp4").write_bytes(_VIDEO)
    return root


@pytest.fixture()
def client(media_root: Path, output_root: Path) -> Iterator[TestClient]:
    settings = ApiSettings(
        host="127.0.0.1",
        port=8737,
        media_dir=media_root,
        output_dir=output_root,
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def _detail(response: Any) -> str:
    return cast(str, cast(dict[str, Any], response.json())["detail"])


def test_downloads_a_video_written_beside_its_image(client: TestClient, media_root: Path) -> None:
    response = client.get(
        "/api/v1/artifacts/download",
        params={"path": str(media_root / "sketches" / "portrait.mp4")},
    )

    assert response.status_code == 200
    assert response.content == _VIDEO
    assert response.headers["content-type"] == "application/octet-stream"
    assert 'filename="portrait.mp4"' in response.headers["content-disposition"]


def test_downloads_a_video_written_into_the_output_volume(
    client: TestClient, output_root: Path
) -> None:
    response = client.get(
        "/api/v1/artifacts/download",
        params={"path": str(output_root / "batch.mp4")},
    )

    assert response.status_code == 200
    assert response.content == _VIDEO


def test_refuses_a_path_outside_the_served_volumes(client: TestClient, tmp_path: Path) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("nope", encoding="utf-8")

    response = client.get("/api/v1/artifacts/download", params={"path": str(secret)})

    assert response.status_code == 422
    assert "outside the served volumes" in _detail(response)
    # The contents never left the disk.
    assert "nope" not in response.text


def test_a_missing_file_is_a_404(client: TestClient, media_root: Path) -> None:
    response = client.get(
        "/api/v1/artifacts/download",
        params={"path": str(media_root / "gone.mp4")},
    )

    assert response.status_code == 404
    assert "File not found" in _detail(response)


def test_a_directory_is_a_422(client: TestClient, media_root: Path) -> None:
    response = client.get(
        "/api/v1/artifacts/download",
        params={"path": str(media_root)},
    )

    assert response.status_code == 422
    assert "not a file" in _detail(response)


def test_requires_a_path(client: TestClient) -> None:
    assert client.get("/api/v1/artifacts/download").status_code == 422
