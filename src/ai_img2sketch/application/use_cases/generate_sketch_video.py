"""Use case: generate a sketch video from an image."""

from __future__ import annotations

import logging
import time
from pathlib import Path

import numpy as np

from ...domain.entities.hand import Hand
from ...domain.entities.image import Image
from ...domain.entities.video import Video
from ...domain.value_objects.video_config import VideoConfig
from ..ports.hand_loader import HandLoader
from ..ports.image_preprocessor import ImagePreprocessor, PreprocessedImage
from ..ports.output_path_generator import OutputPathGenerator
from ..ports.video_writer import VideoWriter, VideoWriterFactory
from ..services.dimension_adjuster import DimensionAdjuster
from ..services.drawing_calculator import DrawingPathCalculator, GridCalculator
from ..services.hand_overlay import HandOverlayService


class GenerateSketchVideoUseCase:
    """Generate an animated sketch video from an image.

    The use case depends only on application ports (abstractions) and pure
    application services. Concrete infrastructure is injected by the
    composition root, so the use case can be unit-tested with fakes.
    """

    def __init__(
        self,
        *,
        hand_image_path: Path,
        hand_mask_path: Path,
        output_directory: Path,
        hand_loader: HandLoader,
        preprocessor: ImagePreprocessor,
        video_writer_factory: VideoWriterFactory,
        output_path_generator: OutputPathGenerator,
        logger: logging.Logger | None = None,
    ) -> None:
        self._hand_image_path = hand_image_path
        self._hand_mask_path = hand_mask_path
        self._output_directory = output_directory
        self._hand_loader = hand_loader
        self._preprocessor = preprocessor
        self._video_writer_factory = video_writer_factory
        self._output_path_generator = output_path_generator
        self._logger = logger if logger is not None else logging.getLogger(__name__)

        # Pure, side-effect-free services are safe to instantiate directly.
        self._dimension_adjuster = DimensionAdjuster()
        self._grid_calculator = GridCalculator()
        self._path_calculator = DrawingPathCalculator()
        self._hand_overlay = HandOverlayService()

    def execute(self, image: Image, config: VideoConfig) -> Path:
        """Generate a sketch video for the given image and configuration.

        Args:
            image: The source image to turn into a sketch video.
            config: Video generation configuration.

        Returns:
            The path of the generated video file.
        """
        start_time = time.perf_counter()
        self._logger.info("Starting sketch video generation...")

        target_dimensions = self._dimension_adjuster.adjust_to_multiple(
            image.dimensions, config.split_len
        )
        self._logger.info(
            "Target dimensions: %dx%d",
            target_dimensions.width,
            target_dimensions.height,
        )

        hand = self._hand_loader.load(self._hand_image_path, self._hand_mask_path)
        self._logger.info(
            "Loaded hand: %dx%d",
            hand.dimensions.width,
            hand.dimensions.height,
        )

        preprocessed = self._preprocessor.preprocess(image, target_dimensions)

        output_path = self._output_path_generator.generate(self._output_directory)
        video = Video(output_path=output_path, dimensions=target_dimensions, config=config)

        writer = self._video_writer_factory(video)
        try:
            self._draw_entire_image(writer, preprocessed, hand, config)
            self._add_final_frames(writer, preprocessed, config)
        finally:
            writer.release()

        elapsed = time.perf_counter() - start_time
        self._logger.info("Video generation completed in %.2f seconds", elapsed)
        self._logger.info("Video saved to: %s", output_path)
        return output_path

    def _draw_entire_image(
        self,
        writer: VideoWriter,
        preprocessed: PreprocessedImage,
        hand: Hand,
        config: VideoConfig,
    ) -> None:
        """Draw the entire image progressively, cell by cell."""
        self._logger.info("Drawing entire image...")

        drawn_frame = np.full(preprocessed.original.shape, 255, dtype=np.uint8)

        n_vertical, n_horizontal = self._grid_calculator.calculate_grid_dimensions(
            preprocessed.dimensions, config.split_len
        )
        grid = self._grid_calculator.split_into_grid(
            preprocessed.thresholded, n_vertical, n_horizontal
        )
        black_indices = self._grid_calculator.find_grids_with_black_pixels(
            grid, config.black_pixel_threshold
        )

        if len(black_indices) == 0:
            self._logger.warning("No black pixels found to draw")
            return

        self._logger.info("Found %d grid cells to draw", len(black_indices))

        selected_idx = 0
        frame_counter = 0
        while len(black_indices) > 0:
            current_cell = black_indices[selected_idx].copy()

            v_start = int(current_cell[0]) * config.split_len
            v_end = v_start + config.split_len
            h_start = int(current_cell[1]) * config.split_len
            h_end = h_start + config.split_len

            grid_section = grid[current_cell[0]][current_cell[1]]
            for channel in range(3):
                drawn_frame[v_start:v_end, h_start:h_end, channel] = grid_section

            hand_x, hand_y = self._hand_overlay.calculate_hand_position(
                h_start, v_start, config.split_len
            )
            frame_with_hand = self._hand_overlay.overlay_hand(
                drawn_frame.copy(), hand, hand_x, hand_y, preprocessed.dimensions
            )

            # Remove the current cell by swapping it with the last one.
            black_indices[selected_idx] = black_indices[-1]
            black_indices = black_indices[:-1]

            frame_counter += 1
            if frame_counter % config.object_skip_rate == 0:
                writer.write_frame(frame_with_hand)

            if frame_counter % 40 == 0:
                self._logger.info("Progress: %d cells remaining", len(black_indices))

            if len(black_indices) > 0:
                selected_idx = self._path_calculator.find_nearest_index(black_indices, current_cell)

    def _add_final_frames(
        self,
        writer: VideoWriter,
        preprocessed: PreprocessedImage,
        config: VideoConfig,
    ) -> None:
        """Add final frames showing the original image."""
        num_frames = config.frame_rate * config.end_duration_sec
        self._logger.info("Adding %d final frames...", num_frames)
        for _ in range(num_frames):
            writer.write_frame(preprocessed.original)
