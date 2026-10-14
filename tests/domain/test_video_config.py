"""Tests for the ``VideoConfig`` value object."""

import pytest
from pydantic import ValidationError

from ai_img2sketch.domain.value_objects.video_config import VideoConfig


def test_defaults() -> None:
    config = VideoConfig()
    assert config.frame_rate == 25
    assert config.split_len == 10
    assert config.object_skip_rate == 8
    assert config.end_duration_sec == 2


def test_rejects_out_of_range_values() -> None:
    with pytest.raises(ValidationError):
        VideoConfig(frame_rate=0)
    with pytest.raises(ValidationError):
        VideoConfig(split_len=0)
    with pytest.raises(ValidationError):
        VideoConfig(end_duration_sec=11)


def test_is_immutable() -> None:
    config = VideoConfig()
    with pytest.raises(ValidationError):
        setattr(config, "frame_rate", 30)  # noqa: B010 - intentionally test immutability
