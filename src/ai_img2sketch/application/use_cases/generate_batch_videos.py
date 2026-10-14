"""Use case: generate a sketch video for every image in a directory."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from ...domain.value_objects.video_config import VideoConfig
from ..ports.image_loader import ImageLoader
from ..ports.image_scanner import ImageDirectoryScanner
from ..ports.sketch_video_generator import SketchVideoGenerator
from ..services.video_path_resolver import VideoPathResolver


@dataclass(frozen=True)
class BatchItemResult:
    """The outcome of processing a single image in a batch."""

    image_path: Path
    output_path: Path | None = None
    error: str | None = None

    @property
    def succeeded(self) -> bool:
        """Whether this image was processed successfully."""
        return self.error is None


@dataclass(frozen=True)
class BatchSummary:
    """The aggregate outcome of a batch run."""

    items: list[BatchItemResult] = field(default_factory=list)

    @property
    def succeeded(self) -> list[BatchItemResult]:
        """The results that completed successfully."""
        return [item for item in self.items if item.succeeded]

    @property
    def failed(self) -> list[BatchItemResult]:
        """The results that failed."""
        return [item for item in self.items if not item.succeeded]


class GenerateVideosFromDirectoryUseCase:
    """Generate one sketch video per image found in a directory.

    Videos are written next to their source image (``<name>.mp4``) unless an
    explicit ``output_directory`` is given. A failure on one image does not stop
    the batch; the failure is recorded in the summary instead.
    """

    def __init__(
        self,
        *,
        image_loader: ImageLoader,
        scanner: ImageDirectoryScanner,
        sketch_use_case: SketchVideoGenerator,
        logger: logging.Logger | None = None,
    ) -> None:
        self._image_loader = image_loader
        self._scanner = scanner
        self._sketch_use_case = sketch_use_case
        self._path_resolver = VideoPathResolver()
        self._logger = logger if logger is not None else logging.getLogger(__name__)

    def execute(
        self,
        directory: Path,
        config: VideoConfig,
        *,
        output_directory: Path | None = None,
        object_mask_path: Path | None = None,
    ) -> BatchSummary:
        """Generate videos for every image in ``directory``.

        Args:
            directory: Folder whose images are processed (top level only).
            config: Video generation configuration shared by every image.
            output_directory: Where to write videos. Defaults to each image's folder.
            object_mask_path: Optional object-mask document applied to every image.

        Returns:
            A ``BatchSummary`` describing each image's outcome.

        Raises:
            ValueError: If the directory contains no supported images.
        """
        image_paths = self._scanner.find_images(directory)
        if not image_paths:
            raise ValueError(f"No supported images found in: {directory}")

        self._logger.info("Found %d image(s) to process in %s", len(image_paths), directory)

        items = [
            self._process_image(image_path, config, output_directory, object_mask_path)
            for image_path in image_paths
        ]
        return BatchSummary(items=items)

    def _process_image(
        self,
        image_path: Path,
        config: VideoConfig,
        output_directory: Path | None,
        object_mask_path: Path | None,
    ) -> BatchItemResult:
        """Generate a video for one image, capturing any failure."""
        output_path = self._path_resolver.resolve(image_path, output_directory)
        self._logger.info("Processing %s -> %s", image_path.name, output_path.name)

        try:
            image = self._image_loader.load(image_path)
            produced_path = self._sketch_use_case.execute(
                image,
                config,
                output_path=output_path,
                object_mask_path=object_mask_path,
            )
        except Exception as exc:  # one bad image must not stop the batch
            self._logger.error("Failed to process %s: %s", image_path.name, exc)
            return BatchItemResult(image_path=image_path, error=str(exc))

        return BatchItemResult(image_path=image_path, output_path=produced_path)
