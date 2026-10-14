"""Tests for the JSON object mask loader adapter."""

import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from ai_img2sketch.domain.value_objects.dimensions import Dimensions
from ai_img2sketch.infrastructure.image_processing.object_mask_loader import JsonObjectMaskLoader


def _write_mask_image(path: Path, size: int = 10, filled: int = 5) -> None:
    mask = np.zeros((size, size), dtype=np.uint8)
    mask[0:filled, 0:filled] = 255
    assert cv2.imwrite(str(path), mask)


def _write_document(path: Path, objects: list[dict[str, object]]) -> None:
    path.write_text(json.dumps({"objects": objects}), encoding="utf-8")


def test_loads_mask_rect_and_catch_all_in_order(tmp_path: Path) -> None:
    _write_mask_image(tmp_path / "face.png")
    _write_document(
        tmp_path / "objects.json",
        [
            {"name": "face", "mask": "face.png", "skip_rate": 3},
            {"name": "sign", "rect": [5, 5, 5, 5]},
            {"name": "background", "skip_rate": 16},
        ],
    )

    masks = JsonObjectMaskLoader().load(
        tmp_path / "objects.json",
        Dimensions(width=10, height=10),
        Dimensions(width=10, height=10),
    )

    assert [mask.name for mask in masks] == ["face", "sign", "background"]

    face_region = masks[0].region
    assert face_region is not None
    assert bool(face_region[0, 0]) is True
    assert bool(face_region[9, 9]) is False
    assert masks[0].skip_rate == 3

    sign_region = masks[1].region
    assert sign_region is not None
    assert bool(sign_region[5, 5]) is True
    assert bool(sign_region[0, 0]) is False
    assert masks[1].skip_rate is None

    assert masks[2].region is None
    assert masks[2].skip_rate == 16


def test_resizes_mask_image_to_target_dimensions(tmp_path: Path) -> None:
    _write_mask_image(tmp_path / "m.png", size=10, filled=5)
    _write_document(tmp_path / "o.json", [{"name": "a", "mask": "m.png"}])

    masks = JsonObjectMaskLoader().load(
        tmp_path / "o.json",
        Dimensions(width=10, height=10),
        Dimensions(width=20, height=20),
    )

    region = masks[0].region
    assert region is not None
    assert region.shape == (20, 20)
    assert bool(region[0, 0]) is True


def test_scales_rect_from_source_to_target_dimensions(tmp_path: Path) -> None:
    # A rectangle covering the top-left quarter of a 100x100 source image
    # must cover the top-left quarter of a 50x50 target image.
    _write_document(tmp_path / "o.json", [{"name": "quadrant", "rect": [0, 0, 50, 50]}])

    masks = JsonObjectMaskLoader().load(
        tmp_path / "o.json",
        Dimensions(width=100, height=100),
        Dimensions(width=50, height=50),
    )

    region = masks[0].region
    assert region is not None
    assert region.shape == (50, 50)
    assert bool(region[0, 0]) is True
    assert bool(region[24, 24]) is True
    assert bool(region[25, 25]) is False
    assert bool(region[49, 49]) is False


def test_rejects_object_with_both_mask_and_rect(tmp_path: Path) -> None:
    _write_document(
        tmp_path / "o.json",
        [{"name": "a", "mask": "m.png", "rect": [0, 0, 1, 1]}],
    )
    with pytest.raises(ValueError, match="both"):
        JsonObjectMaskLoader().load(
            tmp_path / "o.json", Dimensions(width=4, height=4), Dimensions(width=4, height=4)
        )


def test_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        JsonObjectMaskLoader().load(
            tmp_path / "nope.json", Dimensions(width=4, height=4), Dimensions(width=4, height=4)
        )


def test_missing_mask_image_raises(tmp_path: Path) -> None:
    _write_document(tmp_path / "o.json", [{"name": "a", "mask": "missing.png"}])
    with pytest.raises(FileNotFoundError, match="missing.png"):
        JsonObjectMaskLoader().load(
            tmp_path / "o.json", Dimensions(width=4, height=4), Dimensions(width=4, height=4)
        )


def test_invalid_json_is_reported(tmp_path: Path) -> None:
    (tmp_path / "bad.json").write_text("{ not json }", encoding="utf-8")
    with pytest.raises(ValueError, match="Invalid object mask file"):
        JsonObjectMaskLoader().load(
            tmp_path / "bad.json", Dimensions(width=4, height=4), Dimensions(width=4, height=4)
        )


def test_empty_objects_is_reported(tmp_path: Path) -> None:
    _write_document(tmp_path / "o.json", [])
    with pytest.raises(ValueError, match="no objects"):
        JsonObjectMaskLoader().load(
            tmp_path / "o.json", Dimensions(width=4, height=4), Dimensions(width=4, height=4)
        )
