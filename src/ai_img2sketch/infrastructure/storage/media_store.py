"""Filesystem store for images uploaded by the web client.

Uploads land under ``<media root>/uploads`` — the same volume the container
mounts as ``/app/media`` — so the returned path is immediately usable as
``image_path`` in a request, without any further mapping.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path

#: File types accepted from clients: exactly what the image loader can read.
IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp", ".bmp"})

#: Bucket names chosen by clients (one folder per batch upload).
_BUCKET_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")

#: Keeps uploads separate from files the user placed in the media folder.
UPLOAD_SUBDIR = "uploads"

_UNSAFE_NAME_CHARS = re.compile(r"[^A-Za-z0-9_-]+")


class MediaStore:
    """Writes uploads into the media volume and reports their absolute paths."""

    def __init__(self, root: Path) -> None:
        self._root = root

    def store(self, filename: str, content: bytes, directory: str | None = None) -> Path:
        """Persist one upload; see :class:`~...ports.blob_store.BlobStore`."""
        if not content:
            raise ValueError("Empty file")

        # Only the last segment counts: a client cannot escape the store with
        # `../../etc/passwd` or an absolute path.
        name = Path(filename).name.strip()
        if not name or name in {".", ".."}:
            raise ValueError(f"Invalid file name: {filename!r}")

        suffix = Path(name).suffix.lower()
        if suffix not in IMAGE_SUFFIXES:
            supported = ", ".join(sorted(IMAGE_SUFFIXES))
            raise ValueError(
                f"Unsupported file type {suffix or name!r} (expected one of {supported})"
            )

        target_dir = self._root / UPLOAD_SUBDIR
        if directory is not None:
            if not _BUCKET_PATTERN.match(directory):
                raise ValueError(f"Invalid upload directory: {directory!r}")
            target_dir = target_dir / directory
        target_dir.mkdir(parents=True, exist_ok=True)

        # Unique on purpose: two picks of the same file must not overwrite each
        # other, and a batch keeps the original names readable.
        stem = _UNSAFE_NAME_CHARS.sub("-", Path(name).stem).strip("-") or "upload"
        target = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{suffix}"
        target.write_bytes(content)
        return target.resolve()
