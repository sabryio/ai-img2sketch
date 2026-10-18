"""Filesystem reader for files the API produced inside its volumes.

Downloads are confined to the directories the backend already writes to — the
media volume (where renders land by default, beside their image) and the output
volume. Unrestricted reads would turn a local API into a file-exfiltration
endpoint, so containment is checked on the *resolved* path: a symlink pointing
outside a volume is rejected like any other path.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path


class VolumeArtifactReader:
    """Serves files that live inside the volumes the backend owns."""

    def __init__(self, roots: Sequence[Path]) -> None:
        self._roots = tuple(root.expanduser().resolve() for root in roots)

    def resolve(self, path: str) -> Path:
        """Return the readable file at ``path``; see the port for the contract."""
        raw = path.strip()
        if not raw:
            raise ValueError("Empty path")

        resolved = Path(raw).expanduser().resolve()
        if not any(resolved == root or root in resolved.parents for root in self._roots):
            served = ", ".join(str(root) for root in self._roots)
            raise ValueError(f"Path is outside the served volumes ({served}): {path}")

        if resolved.is_dir():
            raise ValueError(f"Path is a directory, not a file: {path}")
        if not resolved.is_file():
            raise FileNotFoundError(f"File not found: {path}")

        return resolved
