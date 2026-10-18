"""Use case: generate a sketch video from an image."""

from __future__ import annotations

import logging
import time
from pathlib import Path

import numpy as np
import numpy.typing as npt

from ...domain.entities.hand import Hand
from ...domain.entities.image import Image
from ...domain.entities.video import Video
from ...domain.value_objects.dimensions import Dimensions
from ...domain.value_objects.object_mask import ObjectMask
from ...domain.value_objects.video_config import VideoConfig
from ..ports.hand_loader import HandLoader
from ..ports.image_preprocessor import ImagePreprocessor, PreprocessedImage
from ..ports.object_mask_loader import ObjectMaskLoader
from ..ports.progress_reporter import GenerationProgress, ProgressReporter
from ..ports.video_writer import VideoWriter, VideoWriterFactory
from ..services.dimension_adjuster import DimensionAdjuster
from ..services.drawing_calculator import DrawingPathCalculator, GridCalculator
from ..services.drawing_planner import DrawingGroup, DrawingPlanner
from ..services.drawing_speed import DrawingSpeedCalculator
from ..services.hand_overlay import HandOverlayService

#: Percent steps reported while drawing. One report per frame would flood the
#: event stream (a six-second video is hundreds of frames) without telling the
#: user anything new, so a step is the unit of "the bar moved".
_PROGRESS_STEP_PERCENT = 5


def _final_frame_count(config: VideoConfig) -> int:
    """How many frames show the finished image, after the drawing."""
    return config.frame_rate * config.end_duration_sec


class _DrawProgress:
    """Turns written frames into throttled, monotonic progress reports."""

    def __init__(self, reporter: ProgressReporter, total_frames: int) -> None:
        self._reporter = reporter
        self._total = max(total_frames, 1)
        self._frame = 0
        self._reported = 0

    def frame_written(self, label: str) -> None:
        """Count one written frame, reporting it once a step has passed."""
        self._frame += 1
        percent = int(self._frame * 100 / self._total)
        at_end = self._frame >= self._total
        if not at_end and percent - self._reported < _PROGRESS_STEP_PERCENT:
            return

        self._reported = percent
        self._reporter.report(
            GenerationProgress(
                percent=percent,
                frame=self._frame,
                total_frames=self._total,
                label=label,
            )
        )


def _start_progress(
    reporter: ProgressReporter | None,
    drawing_frames: int,
    config: VideoConfig,
) -> _DrawProgress | None:
    """Counter for a run, or ``None`` when nobody is listening."""
    if reporter is None:
        return None
    return _DrawProgress(reporter, drawing_frames + _final_frame_count(config))


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
        hand_loader: HandLoader,
        preprocessor: ImagePreprocessor,
        object_mask_loader: ObjectMaskLoader,
        video_writer_factory: VideoWriterFactory,
        logger: logging.Logger | None = None,
    ) -> None:
        self._hand_image_path = hand_image_path
        self._hand_mask_path = hand_mask_path
        self._hand_loader = hand_loader
        self._preprocessor = preprocessor
        self._object_mask_loader = object_mask_loader
        self._video_writer_factory = video_writer_factory
        self._logger = logger if logger is not None else logging.getLogger(__name__)

        # Pure, side-effect-free services are safe to instantiate directly.
        self._dimension_adjuster = DimensionAdjuster()
        self._grid_calculator = GridCalculator()
        self._path_calculator = DrawingPathCalculator()
        self._hand_overlay = HandOverlayService()
        self._drawing_planner = DrawingPlanner()
        self._drawing_speed = DrawingSpeedCalculator()

    def execute(
        self,
        image: Image,
        config: VideoConfig,
        *,
        output_path: Path,
        object_mask_path: Path | None = None,
        progress_reporter: ProgressReporter | None = None,
    ) -> Path:
        """Generate a sketch video for the given image and configuration.

        Args:
            image: The source image to turn into a sketch video.
            config: Video generation configuration.
            output_path: Destination of the video, e.g. ``photo.jpg`` → ``photo.mp4``.
            object_mask_path: Optional object-mask document for this image.
            progress_reporter: Optional sink for progress while drawing.

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

        object_masks = self._load_object_masks(
            object_mask_path, image.dimensions, target_dimensions
        )
        preprocessed = self._preprocessor.preprocess(image, target_dimensions)

        video = Video(output_path=output_path, dimensions=target_dimensions, config=config)

        writer = self._video_writer_factory(video)
        try:
            progress = self._draw_entire_image(
                writer, preprocessed, hand, config, object_masks, progress_reporter
            )
            self._add_final_frames(writer, preprocessed, config, progress)
        finally:
            writer.release()

        elapsed = time.perf_counter() - start_time
        self._logger.info("Video generation completed in %.2f seconds", elapsed)
        self._logger.info("Video saved to: %s", output_path)
        return output_path

    def _load_object_masks(
        self,
        object_mask_path: Path | None,
        source_dimensions: Dimensions,
        target_dimensions: Dimensions,
    ) -> list[ObjectMask]:
        """Load object masks (if configured), scaled to the target dimensions."""
        if object_mask_path is None:
            return []
        masks = self._object_mask_loader.load(
            object_mask_path, source_dimensions, target_dimensions
        )
        names = ", ".join(mask.name for mask in masks)
        self._logger.info("Loaded %d object mask(s): %s", len(masks), names)
        return masks

    def _draw_entire_image(
        self,
        writer: VideoWriter,
        preprocessed: PreprocessedImage,
        hand: Hand,
        config: VideoConfig,
        object_masks: list[ObjectMask],
        reporter: ProgressReporter | None = None,
    ) -> _DrawProgress | None:
        """Draw the image progressively, group by group (object by object).

        Returns the frame counter handed to the final-frames phase, so the run
        reports one continuous percentage; ``None`` when nobody is listening.
        """
        self._logger.info("Drawing entire image...")

        drawn_frame = np.full(preprocessed.original.shape, 255, dtype=np.uint8)

        n_vertical, n_horizontal = self._grid_calculator.calculate_grid_dimensions(
            preprocessed.dimensions, config.split_len
        )
        grid = self._grid_calculator.split_into_grid(
            preprocessed.thresholded, n_vertical, n_horizontal
        )
        black_cells = self._grid_calculator.find_grids_with_black_pixels(
            grid, config.black_pixel_threshold
        )

        if len(black_cells) == 0:
            self._logger.warning("No black pixels found to draw")
            # Only the final frames remain, and they are counted as a whole.
            return _start_progress(reporter, 0, config)

        self._logger.info("Found %d grid cells to draw", len(black_cells))

        skip_rate = self._resolve_skip_rate(config, black_cells, object_masks)

        groups = self._drawing_planner.plan(
            black_cells,
            object_masks,
            preprocessed.dimensions,
            config.split_len,
            skip_rate,
        )

        # Every group writes one frame per `skip_rate` cells it draws.
        progress = _start_progress(
            reporter,
            sum(len(group.cells) // group.skip_rate for group in groups),
            config,
        )

        for group in groups:
            if len(group.cells) == 0:
                continue
            self._logger.info(
                "Drawing %s: %d cells (skip rate %d)",
                group.label,
                len(group.cells),
                group.skip_rate,
            )
            self._draw_group(
                writer,
                drawn_frame,
                hand,
                preprocessed.dimensions,
                grid,
                group,
                config.split_len,
                progress,
            )

        return progress

    def _resolve_skip_rate(
        self,
        config: VideoConfig,
        black_cells: npt.NDArray[np.int_],
        object_masks: list[ObjectMask],
    ) -> int:
        """Return the skip rate to use, honouring a target drawing duration if set."""
        if config.draw_duration_sec is None:
            return config.object_skip_rate

        cell_count = len(black_cells)
        if any(mask.skip_rate is not None for mask in object_masks):
            self._logger.warning(
                "Object masks define their own skip_rate; the drawing duration "
                "may differ from the requested %.2fs",
                config.draw_duration_sec,
            )

        skip_rate = self._drawing_speed.skip_rate_for_duration(
            cell_count, config.draw_duration_sec, config.frame_rate
        )
        achieved = self._drawing_speed.estimate_drawing_seconds(
            cell_count, skip_rate, config.frame_rate
        )
        self._logger.info(
            "Target drawing duration %.2fs -> skip rate %d (~%.2fs)",
            config.draw_duration_sec,
            skip_rate,
            achieved,
        )
        tolerance = 1.0 / config.frame_rate + 0.05
        if abs(achieved - config.draw_duration_sec) > tolerance:
            self._logger.warning(
                "Floored drawing duration to %.2fs (target %.2fs); adjust "
                "--split-len or --frame-rate for a closer match",
                achieved,
                config.draw_duration_sec,
            )
        return skip_rate

    def _draw_group(
        self,
        writer: VideoWriter,
        drawn_frame: npt.NDArray[np.uint8],
        hand: Hand,
        dimensions: Dimensions,
        grid: npt.NDArray,
        group: DrawingGroup,
        split_len: int,
        progress: _DrawProgress | None = None,
    ) -> None:
        """Draw every cell of one group following a nearest-neighbour path."""
        cells = group.cells.copy()
        selected_idx = 0
        frame_counter = 0

        while len(cells) > 0:
            current_cell = cells[selected_idx].copy()

            self._render_cell(drawn_frame, grid, current_cell, split_len)

            v_start = int(current_cell[0]) * split_len
            h_start = int(current_cell[1]) * split_len
            hand_x, hand_y = self._hand_overlay.calculate_hand_position(h_start, v_start, split_len)
            frame_with_hand = self._hand_overlay.overlay_hand(
                drawn_frame.copy(), hand, hand_x, hand_y, dimensions
            )

            # Remove the current cell by swapping it with the last one.
            cells[selected_idx] = cells[-1]
            cells = cells[:-1]

            frame_counter += 1
            if frame_counter % group.skip_rate == 0:
                writer.write_frame(frame_with_hand)
                if progress is not None:
                    progress.frame_written(group.label)

            if frame_counter % 40 == 0:
                self._logger.info("Progress (%s): %d cells remaining", group.label, len(cells))

            if len(cells) > 0:
                selected_idx = self._path_calculator.find_nearest_index(cells, current_cell)

    @staticmethod
    def _render_cell(
        drawn_frame: npt.NDArray[np.uint8],
        grid: npt.NDArray,
        cell: npt.NDArray[np.int_],
        split_len: int,
    ) -> None:
        """Copy one grid cell of the thresholded image into the drawn frame."""
        v_start = int(cell[0]) * split_len
        v_end = v_start + split_len
        h_start = int(cell[1]) * split_len
        h_end = h_start + split_len

        grid_section = grid[cell[0]][cell[1]]
        for channel in range(3):
            drawn_frame[v_start:v_end, h_start:h_end, channel] = grid_section

    def _add_final_frames(
        self,
        writer: VideoWriter,
        preprocessed: PreprocessedImage,
        config: VideoConfig,
        progress: _DrawProgress | None = None,
    ) -> None:
        """Add final frames showing the original image."""
        num_frames = _final_frame_count(config)
        self._logger.info("Adding %d final frames...", num_frames)
        for _ in range(num_frames):
            writer.write_frame(preprocessed.original)
            if progress is not None:
                progress.frame_written("final image")
