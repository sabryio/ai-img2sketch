"""Port for discovering image files inside a directory."""

from pathlib import Path
from typing import Protocol


class ImageDirectoryScanner(Protocol):
    """Interface for listing the images contained in a directory."""

    def find_images(self, directory: Path) -> list[Path]:
        """Return the image paths directly inside ``directory``, sorted by name.

        Only the top level of ``directory`` is inspected; subfolders are ignored.
        """
        ...
