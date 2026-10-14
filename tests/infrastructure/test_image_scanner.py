"""Tests for the filesystem image directory scanner adapter."""

from pathlib import Path

import pytest

from ai_img2sketch.infrastructure.image_processing.image_scanner import FileSystemImageScanner


def _touch(path: Path) -> None:
    path.write_bytes(b"x")


def test_finds_supported_images_sorted_and_ignores_others(tmp_path: Path) -> None:
    _touch(tmp_path / "b.png")
    _touch(tmp_path / "a.jpg")
    _touch(tmp_path / "c.JPEG")
    _touch(tmp_path / "notes.txt")
    _touch(tmp_path / "archive.zip")

    found = FileSystemImageScanner().find_images(tmp_path)

    assert found == [tmp_path / "a.jpg", tmp_path / "b.png", tmp_path / "c.JPEG"]


def test_ignores_subdirectories(tmp_path: Path) -> None:
    _touch(tmp_path / "top.png")
    nested = tmp_path / "nested"
    nested.mkdir()
    _touch(nested / "deep.png")

    found = FileSystemImageScanner().find_images(tmp_path)

    assert found == [tmp_path / "top.png"]


def test_is_non_recursive_and_ignores_directories_named_like_images(tmp_path: Path) -> None:
    (tmp_path / "folder.png").mkdir()

    assert FileSystemImageScanner().find_images(tmp_path) == []


def test_raises_for_a_non_directory(tmp_path: Path) -> None:
    missing = tmp_path / "missing"
    with pytest.raises(NotADirectoryError):
        FileSystemImageScanner().find_images(missing)


def test_custom_extensions_are_honoured(tmp_path: Path) -> None:
    _touch(tmp_path / "a.png")
    _touch(tmp_path / "b.tiff")

    found = FileSystemImageScanner(frozenset({".tiff"})).find_images(tmp_path)

    assert found == [tmp_path / "b.tiff"]
