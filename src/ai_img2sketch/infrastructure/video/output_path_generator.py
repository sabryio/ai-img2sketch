"""Timestamped output-path generator adapter."""

from datetime import datetime
from pathlib import Path

from ...application.ports.output_path_generator import OutputPathGenerator


class TimestampedOutputPathGenerator(OutputPathGenerator):
    """Generates output video paths named by the current time."""

    def generate(self, output_directory: Path) -> Path:
        """Generate a timestamped mp4 path inside the output directory."""
        timestamp = datetime.now().strftime("%H%M%S")
        return output_directory / f"vid-{timestamp}.mp4"
