"""Reads and discards files inside the volumes the backend owns.

One adapter, two roles (:class:`ArtifactReader` and :class:`ArtifactRemover`),
because they share the only thing that matters: which paths the API may touch at
all. The volumes hold whatever a client uploaded and whatever the API rendered,
and nothing outside them is reachable — a local API that would read or delete any
path it is handed is a file-exfiltration endpoint with a friendly name.
"""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import suppress
from pathlib import Path

from .volume_paths import resolved_within_volumes


class VolumeArtifacts:
    """Serves and removes files that live inside the volumes the API owns."""

    def __init__(self, roots: Sequence[Path]) -> None:
        self._roots = tuple(root.expanduser().resolve() for root in roots)

    def resolve(self, path: str) -> Path:
        """Return the readable file at ``path``.

        Raises:
            ValueError: the path is empty, outside the served volumes, or a
                directory.
            FileNotFoundError: nothing exists at that path.
        """
        resolved = resolved_within_volumes(path, self._roots)
        if resolved.is_dir():
            raise ValueError(f"Path is a directory, not a file: {path}")
        if not resolved.is_file():
            raise FileNotFoundError(f"File not found: {path}")
        return resolved

    def remove(self, path: str) -> None:
        """Delete the file at ``path``; see the port for the contract."""
        resolved = resolved_within_volumes(path, self._roots)
        if resolved.is_dir():
            raise ValueError(f"Path is a directory, not a file: {path}")

        # Already gone is success: a cleanup call must be safe to repeat.
        with suppress(FileNotFoundError):
            resolved.unlink()
        self._prune_bucket(resolved)

    def _prune_bucket(self, resolved: Path) -> None:
        """Drop the folder an upload created, once it is empty.

        A browser batch uploads into ``uploads/<bucket>/``; leaving the empty
        folder behind would grow the scratch space one run at a time. Only an
        empty immediate parent goes, and never a volume root itself.
        """
        parent = resolved.parent
        if parent in self._roots:
            return
        with suppress(OSError):
            # rmdir fails on a non-empty folder, which is the point.
            parent.rmdir()
