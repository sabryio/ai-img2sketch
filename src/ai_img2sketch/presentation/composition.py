"""Composition root: wire infrastructure adapters into the application layer.

This is the only place in the codebase that knows about concrete
infrastructure. Everything else depends on abstractions (ports).
"""

from pathlib import Path

from ..application.ports.image_loader import ImageLoader
from ..application.use_cases.generate_sketch_video import GenerateSketchVideoUseCase
from ..infrastructure.image_processing.hand_loader import OpenCVHandLoader
from ..infrastructure.image_processing.image_loader import OpenCVImageLoader
from ..infrastructure.image_processing.preprocessor import OpenCVImagePreprocessor
from ..infrastructure.video.output_path_generator import TimestampedOutputPathGenerator
from ..infrastructure.video.video_writer import create_opencv_video_writer


def create_image_loader() -> ImageLoader:
    """Create the default image loader adapter."""
    return OpenCVImageLoader()


def build_generate_sketch_video_use_case(
    *,
    hand_image_path: Path,
    hand_mask_path: Path,
    output_directory: Path,
) -> GenerateSketchVideoUseCase:
    """Build the ``GenerateSketchVideoUseCase`` with its concrete dependencies."""
    return GenerateSketchVideoUseCase(
        hand_image_path=hand_image_path,
        hand_mask_path=hand_mask_path,
        output_directory=output_directory,
        hand_loader=OpenCVHandLoader(),
        preprocessor=OpenCVImagePreprocessor(),
        video_writer_factory=create_opencv_video_writer,
        output_path_generator=TimestampedOutputPathGenerator(),
    )
