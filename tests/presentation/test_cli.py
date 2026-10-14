"""End-to-end CLI tests exercising the real OpenCV image loader."""

from importlib import resources as importlib_resources
from pathlib import Path

import cv2
import numpy as np
from click.testing import CliRunner

from ai_img2sketch.presentation.cli import cli


def _write_image(path: Path) -> None:
    image = np.full((60, 80, 3), 255, dtype=np.uint8)
    image[10:20, 10:20] = 0
    assert cv2.imwrite(str(path), image)


def test_bundled_hand_assets_are_present() -> None:
    images = importlib_resources.files("ai_img2sketch.resources.images")
    assert (images / "drawing-hand.png").is_file()
    assert (images / "hand-mask.png").is_file()


def test_help_lists_commands() -> None:
    result = CliRunner().invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "generate" in result.output
    assert "info" in result.output


def test_generate_help_lists_object_masks_option() -> None:
    result = CliRunner().invoke(cli, ["generate", "--help"])
    assert result.exit_code == 0
    assert "--object-masks" in result.output


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


def test_generate_on_a_single_image_writes_next_to_it_by_default(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.png"
    _write_image(image_path)

    result = CliRunner().invoke(cli, ["generate", str(image_path), "--end-duration", "0"])

    assert result.exit_code == 0
    assert (tmp_path / "sample.mp4").exists()


def test_generate_on_a_single_image_writes_to_the_output_directory(tmp_path: Path) -> None:
    image_path = tmp_path / "sample.png"
    _write_image(image_path)
    output_directory = tmp_path / "out"

    result = CliRunner().invoke(
        cli,
        ["generate", str(image_path), "--output", str(output_directory), "--end-duration", "0"],
    )

    assert result.exit_code == 0
    assert list(output_directory.glob("*.mp4"))


def test_generate_on_a_directory_writes_a_video_per_image(tmp_path: Path) -> None:
    _write_image(tmp_path / "one.png")
    _write_image(tmp_path / "two.png")
    (tmp_path / "notes.txt").write_text("ignore me", encoding="utf-8")

    result = CliRunner().invoke(cli, ["generate", str(tmp_path), "--end-duration", "0"])

    assert result.exit_code == 0
    assert (tmp_path / "one.mp4").exists()
    assert (tmp_path / "two.mp4").exists()
    assert "Batch Results" in result.output


def test_generate_on_a_directory_reports_when_no_images_are_found(tmp_path: Path) -> None:
    (tmp_path / "notes.txt").write_text("ignore me", encoding="utf-8")

    result = CliRunner().invoke(cli, ["generate", str(tmp_path), "--end-duration", "0"])

    assert result.exit_code != 0
    assert "No supported images" in result.output
