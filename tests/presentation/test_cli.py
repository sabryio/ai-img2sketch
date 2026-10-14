"""End-to-end CLI tests exercising the real OpenCV image loader."""

from pathlib import Path

import cv2
import numpy as np
from click.testing import CliRunner

from ai_img2sketch.presentation.cli import cli


def _write_image(path: Path) -> None:
    image = np.full((60, 80, 3), 255, dtype=np.uint8)
    image[10:20, 10:20] = 0
    assert cv2.imwrite(str(path), image)


def test_help_lists_commands() -> None:
    result = CliRunner().invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "generate" in result.output
    assert "info" in result.output


def test_info_reports_dimensions(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.png"
    _write_image(image_path)

    result = CliRunner().invoke(cli, ["info", str(image_path)])

    assert result.exit_code == 0
    assert "Dimensions" in result.output
    assert "80x60" in result.output


def test_info_rejects_missing_file(tmp_path: Path) -> None:
    result = CliRunner().invoke(cli, ["info", str(tmp_path / "missing.png")])
    assert result.exit_code != 0
