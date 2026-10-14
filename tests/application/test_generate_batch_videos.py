"""Tests for the directory batch use case (driven entirely by fakes)."""

from pathlib import Path

import numpy as np
import pytest

from ai_img2sketch.application.ports.image_loader import ImageLoader
from ai_img2sketch.application.ports.image_scanner import ImageDirectoryScanner
from ai_img2sketch.application.ports.sketch_video_generator import SketchVideoGenerator
from ai_img2sketch.application.use_cases.generate_batch_videos import (
    GenerateVideosFromDirectoryUseCase,
)
from ai_img2sketch.domain.entities.image import Image
from ai_img2sketch.domain.value_objects.video_config import VideoConfig

CONFIG = VideoConfig(frame_rate=1, split_len=10, object_skip_rate=1, end_duration_sec=0)


class FakeScanner(ImageDirectoryScanner):
    def __init__(self, images: list[Path]) -> None:
        self._images = images

    def find_images(self, directory: Path) -> list[Path]:  # noqa: ARG002
        return self._images


class FakeImageLoader(ImageLoader):
    def __init__(self) -> None:
        self.loaded: list[Path] = []

    def load(self, path: Path) -> Image:
        self.loaded.append(path)
        return Image.from_array(np.zeros((4, 4, 3), dtype=np.uint8), path=path)


class FakeSketchGenerator(SketchVideoGenerator):
    def __init__(self, fail_for: set[Path] | None = None) -> None:
        self.calls: list[tuple[Path | None, Path | None, Path | None]] = []
        self._fail_for = fail_for or set()

    def execute(
        self,
        image: Image,
        config: VideoConfig,  # noqa: ARG002
        *,
        output_path: Path | None = None,
        object_mask_path: Path | None = None,
    ) -> Path:
        self.calls.append((image.path, output_path, object_mask_path))
        if image.path in self._fail_for:
            assert image.path is not None
            raise RuntimeError(f"boom: {image.path.name}")
        assert output_path is not None
        return output_path


def _use_case(
    images: list[Path],
    generator: FakeSketchGenerator,
    loader: FakeImageLoader,
) -> GenerateVideosFromDirectoryUseCase:
    return GenerateVideosFromDirectoryUseCase(
        image_loader=loader,
        scanner=FakeScanner(images),
        sketch_use_case=generator,
    )


def test_writes_a_video_next_to_each_image(tmp_path: Path) -> None:
    images = [tmp_path / "a.png", tmp_path / "b.jpg"]
    generator = FakeSketchGenerator()
    loader = FakeImageLoader()
    use_case = _use_case(images, generator, loader)

    summary = use_case.execute(tmp_path, CONFIG)

    assert [item.output_path for item in summary.items] == [
        tmp_path / "a.mp4",
        tmp_path / "b.mp4",
    ]
    assert len(summary.succeeded) == 2
    assert summary.failed == []
    # Input order is preserved.
    assert [call[0] for call in generator.calls] == images


def test_output_directory_overrides_the_destination(tmp_path: Path) -> None:
    images = [tmp_path / "a.png"]
    output_directory = tmp_path / "videos"
    use_case = _use_case(images, FakeSketchGenerator(), FakeImageLoader())

    summary = use_case.execute(tmp_path, CONFIG, output_directory=output_directory)

    assert summary.items[0].output_path == output_directory / "a.mp4"


def test_object_mask_path_is_forwarded(tmp_path: Path) -> None:
    images = [tmp_path / "a.png"]
    mask_path = tmp_path / "objects.json"
    generator = FakeSketchGenerator()
    use_case = _use_case(images, generator, FakeImageLoader())

    use_case.execute(tmp_path, CONFIG, object_mask_path=mask_path)

    assert generator.calls[0][2] == mask_path


def test_a_failing_image_is_recorded_and_the_batch_continues(tmp_path: Path) -> None:
    images = [tmp_path / "a.png", tmp_path / "b.jpg", tmp_path / "c.png"]
    generator = FakeSketchGenerator(fail_for={tmp_path / "b.jpg"})
    loader = FakeImageLoader()
    use_case = _use_case(images, generator, loader)

    summary = use_case.execute(tmp_path, CONFIG)

    assert [item.succeeded for item in summary.items] == [True, False, True]
    assert summary.items[1].output_path is None
    assert summary.items[1].error == "boom: b.jpg"
    assert len(summary.failed) == 1
    # Every image was still attempted.
    assert loader.loaded == images


def test_raises_when_the_directory_has_no_images(tmp_path: Path) -> None:
    use_case = _use_case([], FakeSketchGenerator(), FakeImageLoader())

    with pytest.raises(ValueError, match="No supported images"):
        use_case.execute(tmp_path, CONFIG)
