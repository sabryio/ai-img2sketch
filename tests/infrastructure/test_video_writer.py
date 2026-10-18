"""The video writer: what it produces has to be *playable*, not just written.

A finished render is shown in the app before it is downloaded, which is exactly
what the codec the writer used to choose made impossible — the webview refused
every file. So these tests encode with the writer and decode with OpenCV, a
different library from the one that wrote the file, and check that the pictures
come back and that the codec is the one players accept.
"""

from __future__ import annotations

from pathlib import Path
from typing import cast

import cv2
import numpy as np
import numpy.typing as npt
import pytest

from ai_img2sketch.domain.entities.video import Video
from ai_img2sketch.domain.value_objects.dimensions import Dimensions
from ai_img2sketch.domain.value_objects.video_config import VideoConfig
from ai_img2sketch.infrastructure.video.video_writer import create_pyav_video_writer

PAPER = (245, 245, 245)
INK = (32, 32, 32)


def _write(path: Path, width: int, height: int, frames: int = 3) -> None:
    """Encode ``frames`` sheets, each with a slightly longer ink mark."""
    writer = create_pyav_video_writer(
        Video(
            output_path=path,
            dimensions=Dimensions(width=width, height=height),
            config=VideoConfig(frame_rate=5),
        )
    )
    for index in range(frames):
        frame = np.full((height, width, 3), PAPER, dtype=np.uint8)
        frame[:, : 4 * (index + 1)] = INK
        writer.write_frame(frame)
    writer.release()


def _decode(path: Path) -> list[npt.NDArray[np.uint8]]:
    """Read every frame back out of ``path``."""
    capture = cv2.VideoCapture(str(path))
    assert capture.isOpened(), "what the writer produced cannot be decoded"

    decoded: list[npt.NDArray[np.uint8]] = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        # OpenCV types a frame generically; a decoded one is 8-bit BGR.
        decoded.append(cast("npt.NDArray[np.uint8]", frame))
    capture.release()
    return decoded


def _codec(path: Path) -> str:
    """The four-character code the file declares, as a decoder reads it."""
    capture = cv2.VideoCapture(str(path))
    code = int(capture.get(cv2.CAP_PROP_FOURCC))
    capture.release()
    return "".join(chr((code >> (8 * shift)) & 0xFF) for shift in range(4))


def test_the_frames_come_back_in_order(tmp_path: Path) -> None:
    path = tmp_path / "clip.mp4"

    _write(path, 64, 48)

    decoded = _decode(path)
    # Three frames, including the last one: release() has to drain the encoder,
    # or the tail of a render never reaches the file.
    assert len(decoded) == 3
    assert all(frame.shape == (48, 64, 3) for frame in decoded)

    row = 24
    # The mark grows frame by frame, and the paper stays paper.
    assert decoded[0][row, 1].mean() < 60
    assert decoded[0][row, 10].mean() > 230
    assert decoded[2][row, 10].mean() < 60
    assert decoded[2][row, 60].mean() > 230


def test_the_codec_is_one_a_player_decodes(tmp_path: Path) -> None:
    path = tmp_path / "clip.mp4"

    _write(path, 64, 48)

    # 'mp4v' (MPEG-4 Part 2, what the writer used to emit) is what browsers and
    # desktop webviews refuse; H.264 is what they all play.
    assert _codec(path).lower() in {"avc1", "h264"}


def test_an_odd_canvas_is_padded_to_what_the_codec_can_encode(tmp_path: Path) -> None:
    path = tmp_path / "odd.mp4"

    _write(path, 65, 49)

    decoded = _decode(path)
    # H.264 in 4:2:0 has no odd side, so a 65x49 drawing is encoded at 66x50 —
    # and the drawing itself is untouched, with one edge pixel copied out.
    assert all(frame.shape == (50, 66, 3) for frame in decoded)
    assert decoded[0][2, 2].mean() < 60
    assert decoded[0][2, 60].mean() > 230


def test_creates_the_folder_it_is_asked_to_write_into(tmp_path: Path) -> None:
    path = tmp_path / "out" / "videos" / "clip.mp4"

    _write(path, 32, 32, frames=1)

    assert path.is_file()


def test_writing_after_release_is_refused(tmp_path: Path) -> None:
    writer = create_pyav_video_writer(
        Video(
            output_path=tmp_path / "clip.mp4",
            dimensions=Dimensions(width=32, height=32),
            config=VideoConfig(frame_rate=5),
        )
    )

    writer.release()

    # A released writer has no encoder left, and saying so beats writing into
    # a closed file.
    with pytest.raises(RuntimeError):
        writer.write_frame(np.zeros((32, 32, 3), dtype=np.uint8))
