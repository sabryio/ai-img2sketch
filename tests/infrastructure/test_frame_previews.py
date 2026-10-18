"""FramePreviewStore: run-scoped stills of the frame being drawn.

A preview is scratch for one render — written into the served media volume while
the drawing happens and removed when the run ends — so these tests pin the fate
of the files, not just their creation.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from ai_img2sketch.infrastructure.storage.frame_previews import (
    PREVIEW_SUBDIR,
    FramePreviewStore,
)


def test_writes_a_jpeg_under_the_previews_subdirectory(tmp_path: Path) -> None:
    store = FramePreviewStore(tmp_path)

    path = store.publish(np.zeros((4, 8, 3), dtype=np.uint8))

    assert path is not None
    written = Path(path)
    # <root>/previews/<run>/frame-0001.jpg, one run folder per store.
    assert written.parent.parent == (tmp_path / PREVIEW_SUBDIR).resolve()
    assert written.name == "frame-0001.jpg"
    assert written.is_file()


def test_downscales_a_frame_wider_than_the_limit(tmp_path: Path) -> None:
    store = FramePreviewStore(tmp_path, max_width=16)

    path = store.publish(np.zeros((40, 80, 3), dtype=np.uint8))

    assert path is not None
    written = cv2.imread(path)
    assert written is not None
    # 80x40 is 2:1; the still is as wide as the limit and keeps that ratio.
    assert written.shape[1] == 16
    assert written.shape[0] == 8


def test_returns_none_and_does_not_raise_for_an_unusable_frame(tmp_path: Path) -> None:
    store = FramePreviewStore(tmp_path)

    # Not an image array at all: there is no width to read.
    assert store.publish(np.array(1)) is None


def test_cleanup_removes_the_run_and_leaves_no_previews_directory(tmp_path: Path) -> None:
    store = FramePreviewStore(tmp_path)
    path = store.publish(np.zeros((4, 8, 3), dtype=np.uint8))
    assert path is not None

    store.cleanup()

    # The still is gone, and the empty bucket with it: nothing is left behind.
    assert not Path(path).exists()
    assert not (tmp_path / PREVIEW_SUBDIR).exists()
