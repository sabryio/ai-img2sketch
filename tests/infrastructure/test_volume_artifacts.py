"""VolumeArtifacts: what the API will serve, and what it will discard."""

from __future__ import annotations

from pathlib import Path

import pytest

from ai_img2sketch.infrastructure.storage.volume_artifacts import VolumeArtifacts


@pytest.fixture()
def media(tmp_path: Path) -> Path:
    root = tmp_path / "media"
    (root / "uploads" / "batch-1").mkdir(parents=True)
    (root / "uploads" / "batch-1" / "portrait.png").write_bytes(b"image")
    (root / "uploads" / "portrait.mp4").write_bytes(b"video")
    return root


@pytest.fixture()
def output(tmp_path: Path) -> Path:
    root = tmp_path / "output"
    root.mkdir()
    (root / "batch.mp4").write_bytes(b"video")
    return root


@pytest.fixture()
def artifacts(media: Path, output: Path) -> VolumeArtifacts:
    return VolumeArtifacts([media, output])


def test_reads_a_file_from_either_volume(
    artifacts: VolumeArtifacts, media: Path, output: Path
) -> None:
    assert artifacts.resolve(str(media / "uploads" / "portrait.mp4")).name == "portrait.mp4"
    assert artifacts.resolve(str(output / "batch.mp4")).name == "batch.mp4"


def test_rejects_a_path_outside_the_volumes(artifacts: VolumeArtifacts, tmp_path: Path) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("nope", encoding="utf-8")

    with pytest.raises(ValueError, match="outside the served volumes"):
        artifacts.resolve(str(secret))


def test_rejects_traversal_that_escapes_a_volume(
    artifacts: VolumeArtifacts, media: Path, tmp_path: Path
) -> None:
    (tmp_path / "secret.txt").write_text("nope", encoding="utf-8")

    with pytest.raises(ValueError, match="outside the served volumes"):
        artifacts.resolve(str(media / ".." / "secret.txt"))


def test_rejects_an_empty_path(artifacts: VolumeArtifacts) -> None:
    with pytest.raises(ValueError, match="Empty path"):
        artifacts.resolve("   ")


def test_rejects_a_directory(artifacts: VolumeArtifacts, media: Path) -> None:
    with pytest.raises(ValueError, match="not a file"):
        artifacts.resolve(str(media / "uploads"))
    # The volume root itself is a directory too.
    with pytest.raises(ValueError, match="not a file"):
        artifacts.resolve(str(media))


def test_a_missing_file_is_a_lookup_failure(artifacts: VolumeArtifacts, media: Path) -> None:
    with pytest.raises(FileNotFoundError, match="File not found"):
        artifacts.resolve(str(media / "gone.mp4"))


def test_removes_a_produced_video(artifacts: VolumeArtifacts, output: Path) -> None:
    video = output / "batch.mp4"

    artifacts.remove(str(video))

    assert not video.exists()
    # The volume itself stays: only the file goes.
    assert output.is_dir()


def test_removes_a_staged_upload_and_prunes_its_empty_bucket(
    artifacts: VolumeArtifacts, media: Path
) -> None:
    upload = media / "uploads" / "batch-1" / "portrait.png"

    artifacts.remove(str(upload))

    assert not upload.exists()
    # A batch's bucket would otherwise accumulate one empty folder per run.
    assert not (media / "uploads" / "batch-1").exists()
    assert (media / "uploads").is_dir()


def test_a_bucket_that_still_holds_files_is_kept(artifacts: VolumeArtifacts, media: Path) -> None:
    bucket = media / "uploads" / "batch-1"
    (bucket / "other.png").write_bytes(b"image")

    artifacts.remove(str(bucket / "portrait.png"))

    assert bucket.is_dir()
    assert (bucket / "other.png").exists()


def test_removing_nothing_is_not_an_error(artifacts: VolumeArtifacts, output: Path) -> None:
    # Deleting is idempotent: a repeated cleanup must not fail.
    artifacts.remove(str(output / "gone.mp4"))


def test_refuses_to_remove_a_path_outside_the_volumes(
    artifacts: VolumeArtifacts, tmp_path: Path
) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("nope", encoding="utf-8")

    with pytest.raises(ValueError, match="outside the served volumes"):
        artifacts.remove(str(secret))
    assert secret.exists()


def test_refuses_to_remove_a_directory(artifacts: VolumeArtifacts, media: Path) -> None:
    # One bad path must not take a whole folder of uploads with it.
    with pytest.raises(ValueError, match="not a file"):
        artifacts.remove(str(media / "uploads"))

    assert (media / "uploads").is_dir()
