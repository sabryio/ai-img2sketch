"""Use-case tests using in-memory fakes for every port.

These tests never touch the filesystem or OpenCV: all boundary ports are
replaced with fakes, which is exactly what the ports-and-adapters design buys.
"""

from pathlib import Path

import numpy as np
import numpy.typing as npt

from ai_img2sketch.application.ports.frame_preview import FramePreviewPublisher
from ai_img2sketch.application.ports.hand_loader import HandLoader
from ai_img2sketch.application.ports.image_preprocessor import (
    ImagePreprocessor,
    PreprocessedImage,
)
from ai_img2sketch.application.ports.object_mask_loader import ObjectMaskLoader
from ai_img2sketch.application.ports.progress_reporter import (
    GenerationProgress,
    ProgressReporter,
)
from ai_img2sketch.application.ports.video_writer import VideoWriter, VideoWriterFactory
from ai_img2sketch.application.use_cases.generate_sketch_video import GenerateSketchVideoUseCase
from ai_img2sketch.domain.entities.hand import Hand
from ai_img2sketch.domain.entities.image import Image
from ai_img2sketch.domain.entities.video import Video
from ai_img2sketch.domain.value_objects.dimensions import Dimensions
from ai_img2sketch.domain.value_objects.object_mask import ObjectMask
from ai_img2sketch.domain.value_objects.video_config import VideoConfig


class FakeHandLoader(HandLoader):
    def __init__(self, hand: Hand) -> None:
        self._hand = hand

    def load(self, hand_path: Path, mask_path: Path) -> Hand:  # noqa: ARG002
        return self._hand


class FakeImagePreprocessor(ImagePreprocessor):
    def preprocess(self, image: Image, target_dimensions: Dimensions) -> PreprocessedImage:
        return PreprocessedImage(
            original=image.data,
            grayscale=image.data[:, :, 0],
            thresholded=image.data[:, :, 0],
            dimensions=target_dimensions,
        )


class FakeObjectMaskLoader(ObjectMaskLoader):
    def __init__(self, masks: list[ObjectMask]) -> None:
        self._masks = masks

    def load(
        self,
        mask_path: Path,  # noqa: ARG002
        source_dimensions: Dimensions,  # noqa: ARG002
        target_dimensions: Dimensions,  # noqa: ARG002
    ) -> list[ObjectMask]:
        return self._masks


class RecordingVideoWriter(VideoWriter):
    def __init__(self) -> None:
        self.frames: list[npt.NDArray[np.uint8]] = []
        self.released = False

    def write_frame(self, frame: npt.NDArray[np.uint8]) -> None:
        self.frames.append(frame)

    def release(self) -> None:
        self.released = True


class FakeVideoWriterFactory(VideoWriterFactory):
    def __init__(self) -> None:
        self.writer = RecordingVideoWriter()
        self.created_for: list[Video] = []

    def __call__(self, video: Video) -> VideoWriter:
        self.created_for.append(video)
        return self.writer


def _make_hand() -> Hand:
    # A no-op hand: inverse_mask=1 keeps the frame, transparent hand adds nothing.
    return Hand(
        image_data=np.zeros((2, 2, 3), dtype=np.uint8),
        inverse_mask=np.ones((2, 2), dtype=np.float64),
        dimensions=Dimensions(width=2, height=2),
    )


def _make_image_with_black_cells() -> Image:
    data = np.full((4, 4, 3), 255, dtype=np.uint8)
    data[0:2, 0:2, :] = 0
    data[2:4, 2:4, :] = 0
    return Image.from_array(data)


def _make_6x6_image() -> Image:
    data = np.full((6, 6, 3), 255, dtype=np.uint8)
    data[0:2, 0:2, :] = 0
    data[4:6, 4:6, :] = 0
    return Image.from_array(data)


def _region(shape: tuple[int, int], rows: tuple[int, int]) -> npt.NDArray[np.bool_]:
    region = np.zeros(shape, dtype=np.bool_)
    region[rows[0] : rows[1], :] = True
    return region


def _build_use_case(
    tmp_path: Path,
    factory: FakeVideoWriterFactory,
    object_masks: list[ObjectMask] | None = None,
) -> GenerateSketchVideoUseCase:
    return GenerateSketchVideoUseCase(
        hand_image_path=tmp_path / "hand.png",
        hand_mask_path=tmp_path / "mask.png",
        hand_loader=FakeHandLoader(_make_hand()),
        preprocessor=FakeImagePreprocessor(),
        object_mask_loader=FakeObjectMaskLoader(object_masks or []),
        video_writer_factory=factory,
    )


def test_execute_returns_output_path_releases_writer_and_writes_frames(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    output_path = tmp_path / "out.mp4"
    use_case = _build_use_case(tmp_path, factory)

    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=0)
    result = use_case.execute(_make_image_with_black_cells(), config, output_path=output_path)

    assert result == output_path
    assert factory.writer.released
    # Every black cell is drawn, then no final frames (end_duration_sec=0).
    assert len(factory.writer.frames) == 2


def test_execute_writes_to_the_given_output_path(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    target = tmp_path / "custom" / "name.mp4"
    use_case = _build_use_case(tmp_path, factory)

    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=0)
    result = use_case.execute(_make_image_with_black_cells(), config, output_path=target)

    assert result == target
    assert factory.created_for[0].output_path == target


def test_execute_adds_final_frames(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    use_case = _build_use_case(tmp_path, factory)

    config = VideoConfig(frame_rate=2, split_len=2, object_skip_rate=100, end_duration_sec=1)
    use_case.execute(_make_image_with_black_cells(), config, output_path=tmp_path / "out.mp4")

    # object_skip_rate=100 means no drawing frames; only the final frames remain.
    assert len(factory.writer.frames) == 2


def test_execute_handles_image_without_black_pixels(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    use_case = _build_use_case(tmp_path, factory)

    white = Image.from_array(np.full((4, 4, 3), 255, dtype=np.uint8))
    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=0)

    use_case.execute(white, config, output_path=tmp_path / "out.mp4")

    assert factory.writer.released
    # Nothing to draw and no final frames asked for, but a video holds at least
    # one frame: the finished image, so the run cannot hand back an empty file.
    assert len(factory.writer.frames) == 1
    assert factory.writer.frames[0].shape == (4, 4, 3)


def test_execute_writes_a_frame_when_every_cell_is_skipped(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    use_case = _build_use_case(tmp_path, factory)

    # A skip rate above the cell count draws nothing, and no final frames were
    # asked for: without the floor the video would be empty.
    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=100, end_duration_sec=0)
    use_case.execute(_make_image_with_black_cells(), config, output_path=tmp_path / "out.mp4")

    assert len(factory.writer.frames) == 1


def test_object_masks_draw_in_document_order(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    masks = [
        ObjectMask(name="top", region=_region((6, 6), (0, 3)), skip_rate=1),
        ObjectMask(name="bottom", region=_region((6, 6), (3, 6)), skip_rate=1),
    ]
    use_case = _build_use_case(tmp_path, factory, object_masks=masks)

    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=0)
    use_case.execute(
        _make_6x6_image(),
        config,
        output_path=tmp_path / "out.mp4",
        object_mask_path=tmp_path / "objects.json",
    )

    assert len(factory.writer.frames) == 2
    first, second = factory.writer.frames
    # First frame drew only the top-left (top object) cell.
    assert first[0, 0, 0] == 0
    assert first[5, 5, 0] == 255
    # Second frame also drew the bottom-right (bottom object) cell.
    assert second[5, 5, 0] == 0


def test_object_mask_skip_rate_is_honoured(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    masks = [
        ObjectMask(name="top", region=_region((6, 6), (0, 3)), skip_rate=1),
        ObjectMask(name="bottom", region=_region((6, 6), (3, 6)), skip_rate=2),
    ]
    use_case = _build_use_case(tmp_path, factory, object_masks=masks)

    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=0)
    use_case.execute(
        _make_6x6_image(),
        config,
        output_path=tmp_path / "out.mp4",
        object_mask_path=tmp_path / "objects.json",
    )

    # Only the first object's single cell is emitted (bottom has skip_rate=2).
    assert len(factory.writer.frames) == 1
    assert factory.writer.frames[0][0, 0, 0] == 0


def test_draw_duration_overrides_the_object_skip_rate(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    use_case = _build_use_case(tmp_path, factory)

    # Two black cells. object_skip_rate=100 alone would emit zero drawing frames,
    # but a 1 s target at 1 fps selects skip_rate=2 (one frame) instead.
    config = VideoConfig(
        frame_rate=1,
        split_len=2,
        object_skip_rate=100,
        draw_duration_sec=1.0,
        end_duration_sec=0,
    )
    use_case.execute(_make_image_with_black_cells(), config, output_path=tmp_path / "out.mp4")

    assert len(factory.writer.frames) == 1


class RecordingProgressReporter(ProgressReporter):
    """Collects every update a run reports, in order."""

    def __init__(self) -> None:
        self.updates: list[GenerationProgress] = []

    def report(self, progress: GenerationProgress) -> None:
        self.updates.append(progress)


def test_progress_is_reported_per_step_and_ends_at_one_hundred(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    reporter = RecordingProgressReporter()
    use_case = _build_use_case(tmp_path, factory)

    # Two black cells at skip_rate=1, plus four final frames (1 fps * 4 s).
    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=4)
    use_case.execute(
        _make_image_with_black_cells(),
        config,
        output_path=tmp_path / "out.mp4",
        progress_reporter=reporter,
    )

    assert len(factory.writer.frames) == 6
    assert [update.percent for update in reporter.updates] == [16, 33, 50, 66, 83, 100]
    assert [update.frame for update in reporter.updates] == [1, 2, 3, 4, 5, 6]
    assert {update.total_frames for update in reporter.updates} == {6}
    # Drawing frames carry the group label; the tail is the finished image.
    assert reporter.updates[0].label == "image"
    assert reporter.updates[-1].label == "final image"
    # A single request has no position in a batch.
    assert reporter.updates[-1].item_index is None


def test_progress_reports_steps_rather_than_every_frame(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    reporter = RecordingProgressReporter()
    use_case = _build_use_case(tmp_path, factory)

    # 40 final frames and no drawing frames: one report per frame would be noise
    # on the event stream without telling the user anything new.
    config = VideoConfig(frame_rate=5, split_len=2, object_skip_rate=100, end_duration_sec=8)
    use_case.execute(
        _make_image_with_black_cells(),
        config,
        output_path=tmp_path / "out.mp4",
        progress_reporter=reporter,
    )

    assert len(factory.writer.frames) == 40
    percents = [update.percent for update in reporter.updates]
    assert percents == sorted(percents)
    assert len(set(percents)) == len(percents)
    assert 1 < len(percents) < 40
    assert percents[0] >= 5
    assert percents[-1] == 100


def test_a_run_without_black_pixels_still_reports_the_final_frames(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    reporter = RecordingProgressReporter()
    use_case = _build_use_case(tmp_path, factory)

    white = Image.from_array(np.full((4, 4, 3), 255, dtype=np.uint8))
    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=1)

    use_case.execute(white, config, output_path=tmp_path / "out.mp4", progress_reporter=reporter)

    # Nothing to draw, so the run's whole length is the tail of final frames.
    assert [update.percent for update in reporter.updates] == [100]
    assert reporter.updates[0].frame == 1
    assert reporter.updates[0].total_frames == 1


class RecordingFramePreviewPublisher(FramePreviewPublisher):
    """Collects every frame it is asked to store, in order."""

    def __init__(self) -> None:
        self.frames: list[npt.NDArray[np.uint8]] = []

    def publish(self, frame: npt.NDArray[np.uint8]) -> str | None:
        self.frames.append(frame)
        return f"/media/previews/frame-{len(self.frames):04d}.jpg"


def test_one_still_is_published_per_report_not_per_frame(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    reporter = RecordingProgressReporter()
    previews = RecordingFramePreviewPublisher()
    use_case = _build_use_case(tmp_path, factory)

    # 40 written frames but only a handful of reports: the throttle must hold,
    # and each still must match exactly one report.
    config = VideoConfig(frame_rate=5, split_len=2, object_skip_rate=100, end_duration_sec=8)
    use_case.execute(
        _make_image_with_black_cells(),
        config,
        output_path=tmp_path / "out.mp4",
        progress_reporter=reporter,
        previews=previews,
    )

    assert len(factory.writer.frames) == 40
    assert 1 < len(reporter.updates) < 40
    assert len(previews.frames) == len(reporter.updates)
    # The still each report names is the one the publisher handed back.
    assert [update.preview_path for update in reporter.updates] == [
        f"/media/previews/frame-{index:04d}.jpg" for index in range(1, len(reporter.updates) + 1)
    ]


def test_the_still_published_is_the_frame_that_was_written(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    reporter = RecordingProgressReporter()
    previews = RecordingFramePreviewPublisher()
    use_case = _build_use_case(tmp_path, factory)

    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=0)
    use_case.execute(
        _make_image_with_black_cells(),
        config,
        output_path=tmp_path / "out.mp4",
        progress_reporter=reporter,
        previews=previews,
    )

    # The drawing frame carries the hand overlay, so it need not equal the cell
    # frame; the point is that the still is the frame written to the video.
    assert len(previews.frames) == len(factory.writer.frames)
    assert np.array_equal(previews.frames[0], factory.writer.frames[0])


def test_reports_carry_no_preview_path_without_a_publisher(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    reporter = RecordingProgressReporter()
    use_case = _build_use_case(tmp_path, factory)

    config = VideoConfig(frame_rate=5, split_len=2, object_skip_rate=100, end_duration_sec=8)
    use_case.execute(
        _make_image_with_black_cells(),
        config,
        output_path=tmp_path / "out.mp4",
        progress_reporter=reporter,
    )

    # Nobody is publishing stills, so there is nothing to name.
    assert reporter.updates
    assert all(update.preview_path is None for update in reporter.updates)
