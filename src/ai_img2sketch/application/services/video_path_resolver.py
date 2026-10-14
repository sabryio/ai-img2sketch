"""Pure helper that decides where a generated sketch video is written."""

from pathlib import Path


class VideoPathResolver:
    """Resolves the output path for a sketch video.

    A video is always named after its source image (``photo.jpg`` →
    ``photo.mp4``) and, by default, written next to it. Passing an explicit
    ``output_directory`` redirects every video to that folder while keeping the
    same name, so single-image and folder runs behave consistently.
    """

    def resolve(self, image_path: Path, output_directory: Path | None = None) -> Path:
        """Return the ``<name>.mp4`` path for ``image_path``."""
        directory = output_directory if output_directory is not None else image_path.parent
        return directory / f"{image_path.stem}.mp4"
