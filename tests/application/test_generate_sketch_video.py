"""Use-case tests using in-memory fakes for every port.

These tests never touch the filesystem or OpenCV: all boundary ports are
replaced with fakes, which is exactly what the ports-and-adapters design buys.
"""

from pathlib import Path

import numpy as np
import numpy.typing as npt

from ai_img2sketch.application.ports.hand_loader import HandLoader
from ai_img2sketch.application.ports.image_preprocessor import (
    ImagePreprocessor,
    PreprocessedImage,
)
from ai_img2sketch.application.ports.output_path_generator import OutputPathGenerator
from ai_img2sketch.application.ports.video_writer import VideoWriter, VideoWriterFactory
from ai_img2sketch.application.use_cases.generate_sketch_video import GenerateSketchVideoUseCase
from ai_img2sketch.domain.entities.hand import Hand
from ai_img2sketch.domain.entities.image import Image
from ai_img2sketch.domain.entities.video import Video
from ai_img2sketch.domain.value_objects.dimensions import Dimensions
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
    return Hand(
        image_data=np.zeros((2, 2, 3), dtype=np.uint8),
        inverse_mask=np.zeros((2, 2), dtype=np.float64),
        dimensions=Dimensions(width=2, height=2),
    )


def _make_image_with_black_cells() -> Image:
    data = np.full((4, 4, 3), 255, dtype=np.uint8)
    data[0:2, 0:2, :] = 0
    data[2:4, 2:4, :] = 0
    return Image.from_array(data)


def _build_use_case(
    tmp_path: Path, factory: FakeVideoWriterFactory, output_path: Path
) -> GenerateSketchVideoUseCase:
    return GenerateSketchVideoUseCase(
        hand_image_path=tmp_path / "hand.png",
        hand_mask_path=tmp_path / "mask.png",
        output_directory=tmp_path,
        hand_loader=FakeHandLoader(_make_hand()),
        preprocessor=FakeImagePreprocessor(),
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
