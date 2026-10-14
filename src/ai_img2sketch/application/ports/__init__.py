"""Ports (interfaces) that the application layer depends on.

These abstractions invert the dependencies between the application layer and
the outer layers (infrastructure, presentation): the application defines the
contracts, and the outer layers provide the implementations.
"""

from .hand_loader import HandLoader
from .image_loader import ImageLoader
from .image_preprocessor import ImagePreprocessor, PreprocessedImage
from .object_mask_loader import ObjectMaskLoader
from .output_path_generator import OutputPathGenerator
from .video_writer import VideoWriter, VideoWriterFactory

__all__ = [
    "HandLoader",
    "ImageLoader",
    "ImagePreprocessor",
    "ObjectMaskLoader",
    "OutputPathGenerator",
    "PreprocessedImage",
    "VideoWriter",
    "VideoWriterFactory",
]
