"""VolumeArtifactReader: downloads stay inside the volumes the API serves."""

from __future__ import annotations

from pathlib import Path

import pytest

from ai_img2sketch.infrastructure.storage.artifact_reader import VolumeArtifactReader


@pytest.fixture()
def media(tmp_path: Path) -> Path:
    root = tmp_path / "media"
    (root / "sketches").mkdir(parents=True)
    (root / "sketches" / "portrait.mp4").write_bytes(b"video")
    return root


@pytest.fixture()
def output(tmp_path: Path) -> Path:
    root = tmp_path / "output"
    root.mkdir()
    (root / "batch.mp4").write_bytes(b"video")
    return root


def test_reads_a_file_from_either_volume(media: Path, output: Path) -> None:
    reader = VolumeArtifactReader([media, output])

    assert reader.resolve(str(media / "sketches" / "portrait.mp4")).name == "portrait.mp4"
    assert reader.resolve(str(output / "batch.mp4")).name == "batch.mp4"


def test_rejects_a_path_outside_the_volumes(media: Path, output: Path, tmp_path: Path) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("nope", encoding="utf-8")

    with pytest.raises(ValueError, match="outside the served volumes"):
        VolumeArtifactReader([media, output]).resolve(str(secret))


def test_rejects_traversal_that_escapes_a_volume(media: Path, output: Path, tmp_path: Path) -> None:
    (tmp_path / "secret.txt").write_text("nope", encoding="utf-8")

    with pytest.raises(ValueError, match="outside the served volumes"):
        VolumeArtifactReader([media, output]).resolve(str(media / ".." / "secret.txt"))


def test_rejects_an_empty_path(media: Path, output: Path) -> None:
    with pytest.raises(ValueError, match="Empty path"):
        VolumeArtifactReader([media, output]).resolve("   ")


def test_rejects_a_directory(media: Path, output: Path) -> None:
    reader = VolumeArtifactReader([media, output])

    with pytest.raises(ValueError, match="not a file"):
        reader.resolve(str(media / "sketches"))
    # The volume root itself is a directory too.
    with pytest.raises(ValueError, match="not a file"):
        reader.resolve(str(media))


def test_a_missing_file_is_a_lookup_failure(media: Path, output: Path) -> None:
    with pytest.raises(FileNotFoundError, match="File not found"):
        VolumeArtifactReader([media, output]).resolve(str(media / "gone.mp4"))
