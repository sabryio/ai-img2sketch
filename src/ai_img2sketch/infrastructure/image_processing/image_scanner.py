"""Filesystem-backed image directory scanner adapter."""

from pathlib import Path

from ...application.ports.image_scanner import ImageDirectoryScanner

SUPPORTED_IMAGE_EXTENSIONS: frozenset[str] = frozenset(
    {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"}
)


class FileSystemImageScanner(ImageDirectoryScanner):
    """Lists image files directly inside a directory, sorted by name."""

    def __init__(self, extensions: frozenset[str] = SUPPORTED_IMAGE_EXTENSIONS) -> None:
        self._extensions = frozenset(extension.lower() for extension in extensions)

    def find_images(self, directory: Path) -> list[Path]:
        """Return the image files at the top level of ``directory``."""
        if not directory.is_dir():
            raise NotADirectoryError(f"Not a directory: {directory}")
        return sorted(
            path
            for path in directory.iterdir()
            if path.is_file() and path.suffix.lower() in self._extensions
        )
