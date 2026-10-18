"""MediaStore: naming, sanitizing and bucketing of client uploads."""

from __future__ import annotations

from pathlib import Path

import pytest

from ai_img2sketch.infrastructure.storage.media_store import MediaStore

_CONTENT = b"image-bytes"


def test_writes_into_the_uploads_subdirectory(tmp_path: Path) -> None:
    stored = MediaStore(tmp_path).store("holiday photo.PNG", _CONTENT)

    assert stored.parent == (tmp_path / "uploads").resolve()
    assert stored.read_bytes() == _CONTENT
    # Extension is normalized so the loader's suffix check matches.
    assert stored.suffix == ".png"
    # Spaces would break a shell copy/paste later on.
    assert " " not in stored.name


def test_each_upload_gets_its_own_name(tmp_path: Path) -> None:
    store = MediaStore(tmp_path)

    first = store.store("same.png", _CONTENT)
    second = store.store("same.png", _CONTENT)

    assert first != second
    assert first.parent == second.parent


def test_rejects_empty_content(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Empty file"):
        MediaStore(tmp_path).store("x.png", b"")


def test_rejects_a_path_only_name(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Invalid file name"):
        MediaStore(tmp_path).store("../", _CONTENT)


def test_rejects_an_unreadable_file_type(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Unsupported file type"):
        MediaStore(tmp_path).store("movie.mp4", _CONTENT)


def test_rejects_a_bucket_with_separators(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Invalid upload directory"):
        MediaStore(tmp_path).store("x.png", _CONTENT, directory="a/b")
