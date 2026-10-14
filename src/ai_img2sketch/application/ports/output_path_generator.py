"""Port for generating unique output video paths."""

from pathlib import Path
from typing import Protocol


class OutputPathGenerator(Protocol):
    """Interface for generating output paths for new videos."""

    def generate(self, output_directory: Path) -> Path:
        """Generate an output path for a new video."""
        ...
