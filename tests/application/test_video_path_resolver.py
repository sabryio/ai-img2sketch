"""Tests for the pure video path resolver."""

from pathlib import Path

from ai_img2sketch.application.services.video_path_resolver import VideoPathResolver


def test_defaults_to_the_image_directory_with_the_image_name() -> None:
    resolver = VideoPathResolver()

    assert resolver.resolve(Path("photos") / "holiday.jpg") == Path("photos") / "holiday.mp4"


def test_replaces_any_extension() -> None:
    resolver = VideoPathResolver()

    assert resolver.resolve(Path("a") / "pic.jpeg") == Path("a") / "pic.mp4"
    assert resolver.resolve(Path("a") / "pic.PNG") == Path("a") / "pic.mp4"


def test_keeps_dotted_stems() -> None:
    resolver = VideoPathResolver()

    assert resolver.resolve(Path("a") / "my.photo.png") == Path("a") / "my.photo.mp4"


def test_output_directory_override_keeps_the_image_name() -> None:
    resolver = VideoPathResolver()

    resolved = resolver.resolve(Path("a") / "pic.png", Path("out"))

    assert resolved == Path("out") / "pic.mp4"
