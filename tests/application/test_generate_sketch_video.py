"""Use-case tests using in-memory fakes for every port.

These tests never touch the filesystem or OpenCV: all boundary ports are
replaced with fakes, which is exactly what the ports-and-adapters design buys.
"""

from pathlib import Path

import numpy as np
import numpy.typing as npt
import pytest

from ai_img2sketch.application.ports.hand_loader import HandLoader
from ai_img2sketch.application.ports.image_preprocessor import (
    ImagePreprocessor,
    PreprocessedImage,
)
from ai_img2sketch.application.ports.object_mask_loader import ObjectMaskLoader
from ai_img2sketch.application.ports.output_path_generator import OutputPathGenerator
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


class FakeOutputPathGenerator(OutputPathGenerator):
    def __init__(self, path: Path) -> None:
        self._path = path

    def generate(self, output_directory: Path) -> Path:  # noqa: ARG002
        return self._path


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
    output_path: Path,
    object_masks: list[ObjectMask] | None = None,
    with_output_directory: bool = True,
) -> GenerateSketchVideoUseCase:
    return GenerateSketchVideoUseCase(
        hand_image_path=tmp_path / "hand.png",
        hand_mask_path=tmp_path / "mask.png",
        output_directory=tmp_path if with_output_directory else None,
        hand_loader=FakeHandLoader(_make_hand()),
        preprocessor=FakeImagePreprocessor(),
        object_mask_loader=FakeObjectMaskLoader(object_masks or []),
        video_writer_factory=factory,
        output_path_generator=FakeOutputPathGenerator(output_path),
    )


def test_execute_returns_output_path_releases_writer_and_writes_frames(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    output_path = tmp_path / "out.mp4"
    use_case = _build_use_case(tmp_path, factory, output_path)

    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=0)
    result = use_case.execute(_make_image_with_black_cells(), config)

    assert result == output_path
    assert factory.writer.released
    # Every black cell is drawn, then no final frames (end_duration_sec=0).
    assert len(factory.writer.frames) == 2


def test_execute_adds_final_frames(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    use_case = _build_use_case(tmp_path, factory, tmp_path / "out.mp4")

    config = VideoConfig(frame_rate=2, split_len=2, object_skip_rate=100, end_duration_sec=1)
    use_case.execute(_make_image_with_black_cells(), config)

    # object_skip_rate=100 means no drawing frames; only the final frames remain.
    assert len(factory.writer.frames) == 2


def test_execute_handles_image_without_black_pixels(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    use_case = _build_use_case(tmp_path, factory, tmp_path / "out.mp4")

    white = Image.from_array(np.full((4, 4, 3), 255, dtype=np.uint8))
    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=0)

    use_case.execute(white, config)

    assert factory.writer.released
    assert factory.writer.frames == []


def test_object_masks_draw_in_document_order(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    masks = [
        ObjectMask(name="top", region=_region((6, 6), (0, 3)), skip_rate=1),
        ObjectMask(name="bottom", region=_region((6, 6), (3, 6)), skip_rate=1),
    ]
    use_case = _build_use_case(tmp_path, factory, tmp_path / "out.mp4", object_masks=masks)

    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=0)
    use_case.execute(_make_6x6_image(), config, object_mask_path=tmp_path / "objects.json")

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
    use_case = _build_use_case(tmp_path, factory, tmp_path / "out.mp4", object_masks=masks)

    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=0)
    use_case.execute(_make_6x6_image(), config, object_mask_path=tmp_path / "objects.json")

    # Only the first object's single cell is emitted (bottom has skip_rate=2).
    assert len(factory.writer.frames) == 1
    assert factory.writer.frames[0][0, 0, 0] == 0


def test_execute_uses_explicit_output_path(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    use_case = _build_use_case(tmp_path, factory, tmp_path / "ignored.mp4")
    target = tmp_path / "custom" / "name.mp4"

    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=0)
    result = use_case.execute(_make_image_with_black_cells(), config, output_path=target)

    assert result == target
    assert factory.created_for[0].output_path == target


def test_execute_requires_an_output_destination(tmp_path: Path) -> None:
    factory = FakeVideoWriterFactory()
    use_case = _build_use_case(tmp_path, factory, tmp_path / "out.mp4", with_output_directory=False)

    config = VideoConfig(frame_rate=1, split_len=2, object_skip_rate=1, end_duration_sec=0)
    with pytest.raises(ValueError, match="output_path or output_directory"):
        use_case.execute(_make_image_with_black_cells(), config)
