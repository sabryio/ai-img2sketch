"""Tests for the directory batch use case (driven entirely by fakes)."""

from pathlib import Path

import numpy as np
import numpy.typing as npt
import pytest

from ai_img2sketch.application.ports.frame_preview import FramePreviewPublisher
from ai_img2sketch.application.ports.image_loader import ImageLoader
from ai_img2sketch.application.ports.image_scanner import ImageDirectoryScanner
from ai_img2sketch.application.ports.progress_reporter import (
    GenerationProgress,
    ProgressReporter,
)
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
    def __init__(self, fail_for: set[Path] | None = None, preview_path: str | None = None) -> None:
        self.calls: list[tuple[Path | None, Path, Path | None]] = []
        self.previews: list[FramePreviewPublisher | None] = []
        self._fail_for = fail_for or set()
        self._preview_path = preview_path

    def execute(
        self,
        image: Image,
        config: VideoConfig,  # noqa: ARG002
        *,
        output_path: Path,
        object_mask_path: Path | None = None,
        progress_reporter: ProgressReporter | None = None,
        previews: FramePreviewPublisher | None = None,
    ) -> Path:
        self.calls.append((image.path, output_path, object_mask_path))
        self.previews.append(previews)
        if progress_reporter is not None:
            # What the real use case reports halfway through an image.
            progress_reporter.report(
                GenerationProgress(
                    percent=50,
                    frame=1,
                    total_frames=2,
                    label="image",
                    preview_path=self._preview_path,
                )
            )
        if image.path in self._fail_for:
            assert image.path is not None
            raise RuntimeError(f"boom: {image.path.name}")
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


class RecordingProgressReporter(ProgressReporter):
    """Collects every update a run reports, in order."""

    def __init__(self) -> None:
        self.updates: list[GenerationProgress] = []

    def report(self, progress: GenerationProgress) -> None:
        self.updates.append(progress)


def test_progress_is_scaled_across_the_whole_batch(tmp_path: Path) -> None:
    images = [tmp_path / "a.png", tmp_path / "b.png"]
    reporter = RecordingProgressReporter()
    use_case = _use_case(images, FakeSketchGenerator(), FakeImageLoader())

    use_case.execute(tmp_path, CONFIG, progress_reporter=reporter)

    # Each image announces its own slice, then reports halfway through it, so the
    # overall percentage only ever moves forward.
    assert [
        (update.item_index, update.item_total, update.item_name, update.percent)
        for update in reporter.updates
    ] == [
        (1, 2, "a.png", 0),
        (1, 2, "a.png", 25),
        (2, 2, "b.png", 50),
        (2, 2, "b.png", 75),
    ]


def test_the_batch_reporter_passes_frame_detail_through(tmp_path: Path) -> None:
    reporter = RecordingProgressReporter()
    use_case = _use_case([tmp_path / "a.png"], FakeSketchGenerator(), FakeImageLoader())

    use_case.execute(tmp_path, CONFIG, progress_reporter=reporter)

    halfway = reporter.updates[-1]
    assert halfway.frame == 1
    assert halfway.total_frames == 2
    assert halfway.label == "image"


def test_the_batch_reporter_passes_the_preview_path_through(tmp_path: Path) -> None:
    reporter = RecordingProgressReporter()
    generator = FakeSketchGenerator(preview_path="/media/previews/a/frame-0001.jpg")
    use_case = _use_case([tmp_path / "a.png"], generator, FakeImageLoader())

    use_case.execute(tmp_path, CONFIG, progress_reporter=reporter)

    # The still the inner use case published must survive the batch wrapper.
    assert reporter.updates[-1].preview_path == "/media/previews/a/frame-0001.jpg"


def test_the_preview_publisher_is_forwarded_to_the_inner_use_case(tmp_path: Path) -> None:
    generator = FakeSketchGenerator()
    previews = FakeFramePreviewPublisher()
    use_case = _use_case([tmp_path / "a.png"], generator, FakeImageLoader())

    use_case.execute(tmp_path, CONFIG, previews=previews)

    assert generator.previews == [previews]


class FakeFramePreviewPublisher(FramePreviewPublisher):
    """A stand-in publisher: identity is all this test cares about."""

    def publish(self, frame: npt.NDArray[np.uint8]) -> str | None:  # noqa: ARG002
        return "/media/previews/frame-0001.jpg"


def test_a_batch_without_a_reporter_still_runs(tmp_path: Path) -> None:
    use_case = _use_case([tmp_path / "a.png"], FakeSketchGenerator(), FakeImageLoader())

    # Nobody listening is the normal CLI case, not an error.
    assert use_case.execute(tmp_path, CONFIG).succeeded
