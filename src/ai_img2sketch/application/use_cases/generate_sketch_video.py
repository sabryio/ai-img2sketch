"""Use case for generating sketch video from image."""

import time
from pathlib import Path

import numpy as np

from ...domain.entities.hand import Hand
from ...domain.entities.image import Image
from ...domain.entities.video import Video
from ...domain.value_objects.video_config import VideoConfig
from ...infrastructure.image_processing.dimension_adjuster import DimensionAdjuster
from ...infrastructure.image_processing.drawing_calculator import (
    DrawingPathCalculator,
    GridCalculator,
)
from ...infrastructure.image_processing.hand_overlay import HandOverlayService
from ...infrastructure.image_processing.preprocessor import OpenCVImagePreprocessor
from ...infrastructure.video.video_writer import OpenCVVideoWriter


class GenerateSketchVideoUseCase:
    """Use case: Generate animated sketch video from an image."""

    def __init__(
        self,
        hand_image_path: Path,
        hand_mask_path: Path,
        output_directory: Path,
    ):
        """Initialize use case with dependencies."""
        self.hand_image_path = hand_image_path
        self.hand_mask_path = hand_mask_path
        self.output_directory = output_directory
        self.preprocessor = OpenCVImagePreprocessor()
        self.hand_overlay_service = HandOverlayService()
        self.dimension_adjuster = DimensionAdjuster()
        self.grid_calculator = GridCalculator()
        self.path_calculator = DrawingPathCalculator()

    def execute(
        self,
        image: Image,
        config: VideoConfig,
        mask_path: Path | None = None,
    ) -> Path:
        """Execute the use case to generate sketch video."""
        start_time = time.time()
        print("Starting sketch video generation...")

        # Adjust dimensions if needed
        target_dimensions = self.dimension_adjuster.adjust_to_standard(
            image.dimensions, config.split_len
        )
        print(f"Target dimensions: {target_dimensions.width}x{target_dimensions.height}")

        # Load hand
        hand = Hand.load(self.hand_image_path, self.hand_mask_path)
        print(f"Loaded hand: {hand.dimensions.width}x{hand.dimensions.height}")

        # Preprocess image
        preprocessed = self.preprocessor.preprocess(image, target_dimensions)

        # Create video entity
        output_path = self._generate_output_path()
        video = Video(
            output_path=output_path,
            dimensions=target_dimensions,
            config=config,
        )

        # Generate video
        with OpenCVVideoWriter(video) as writer:
            self._draw_sketch_animation(
                writer=writer,
                preprocessed=preprocessed,
                hand=hand,
                config=config,
                mask_path=mask_path,
            )

            # Add final colored frames
            self._add_final_frames(writer, preprocessed, config)

        elapsed = time.time() - start_time
        print(f"Video generation completed in {elapsed:.2f} seconds")
        print(f"Video saved to: {output_path}")

        return output_path

    def _draw_sketch_animation(
        self,
        writer: OpenCVVideoWriter,
        preprocessed,
        hand: Hand,
        config: VideoConfig,
        mask_path: Path | None,
    ) -> None:
        """Draw the sketch animation."""
        if mask_path is not None:
            self._draw_with_object_masks(writer, preprocessed, hand, config, mask_path)
        else:
            self._draw_entire_image(writer, preprocessed, hand, config)

    def _draw_entire_image(
        self,
        writer: OpenCVVideoWriter,
        preprocessed,
        hand: Hand,
        config: VideoConfig,
    ) -> None:
        """Draw the entire image without object masking."""
        print("Drawing entire image...")

        # Initialize blank canvas
        drawn_frame = np.full(preprocessed.original.shape, 255, dtype=np.uint8)

        # Calculate grid
        n_vertical, n_horizontal = self.grid_calculator.calculate_grid_dimensions(
            preprocessed.dimensions, config.split_len
        )

        # Split into grid
        grid = self.grid_calculator.split_into_grid(
            preprocessed.thresholded, n_vertical, n_horizontal
        )

        # Find grids with black pixels
        black_indices = self.grid_calculator.find_grids_with_black_pixels(
            grid, config.black_pixel_threshold
        )

        if len(black_indices) == 0:
            print("No black pixels found to draw")
            return

        print(f"Found {len(black_indices)} grid cells to draw")

        # Start drawing
        selected_idx = 0
        frame_counter = 0

        while len(black_indices) > 1:
            current_cell = black_indices[selected_idx].copy()

            # Calculate grid position
            v_start = current_cell[0] * config.split_len
            v_end = v_start + config.split_len
            h_start = current_cell[1] * config.split_len
            h_end = h_start + config.split_len

            # Copy grid cell to drawn frame (all 3 channels)
            grid_section = grid[current_cell[0]][current_cell[1]]
            for channel in range(3):
                drawn_frame[v_start:v_end, h_start:h_end, channel] = grid_section

            # Overlay hand
            hand_x, hand_y = self.hand_overlay_service.calculate_hand_position(
                h_start, v_start, config.split_len
            )
            frame_with_hand = self.hand_overlay_service.overlay_hand(
                drawn_frame.copy(), hand, hand_x, hand_y, preprocessed.dimensions
            )

            # Remove current cell from list
            black_indices[selected_idx] = black_indices[-1]
            black_indices = black_indices[:-1]

            # Find nearest next cell
            distances = self.path_calculator.calculate_euclidean_distance(
                black_indices, current_cell
            )
            selected_idx = int(np.argmin(distances))

            # Write frame based on skip rate
            frame_counter += 1
            if frame_counter % config.object_skip_rate == 0:
                writer.write_frame(frame_with_hand)

            if frame_counter % 40 == 0:
                print(f"Progress: {len(black_indices)} cells remaining")

        # Final frame: show original image
        drawn_frame[:, :, :] = preprocessed.original

    def _draw_with_object_masks(
        self,
        writer: OpenCVVideoWriter,
        preprocessed,
        hand: Hand,
        config: VideoConfig,
        _mask_path: Path,
    ) -> None:
        """Draw with object masks (future implementation)."""
        # For now, fall back to drawing entire image
        print("Object mask drawing not yet implemented, drawing entire image")
        self._draw_entire_image(writer, preprocessed, hand, config)

    def _add_final_frames(
        self,
        writer: OpenCVVideoWriter,
        preprocessed,
        config: VideoConfig,
    ) -> None:
        """Add final colored image frames."""
        num_frames = config.frame_rate * config.end_duration_sec
        print(f"Adding {num_frames} final frames...")

        for _ in range(num_frames):
            writer.write_frame(preprocessed.original)

    def _generate_output_path(self) -> Path:
        """Generate unique output video path."""
        from datetime import datetime

        timestamp = datetime.now().strftime("%H%M%S")
        filename = f"vid-{timestamp}.mp4"

        # Ensure output directory exists
        self.output_directory.mkdir(parents=True, exist_ok=True)

        return self.output_directory / filename
