"""Port for discarding files the API itself staged or produced.

The write side (``BlobStore``) stages a client's upload, the read side
(``ArtifactReader``) hands a produced file back, and this is the third edge:
the client saying "I have it now, drop it". A client that keeps nothing on the
server is how this API is used from a browser or a desktop shell, which can only
reach files by uploading and downloading them.
"""

from __future__ import annotations

from typing import Protocol


class ArtifactRemover(Protocol):
    """Deletes files that live inside the volumes the API owns."""

    def remove(self, path: str) -> None:
        """Delete the file at ``path``.

        Idempotent on purpose: a path that is already gone is not an error,
        because a cleanup call must not fail just because a previous one
        succeeded (DELETE semantics).

        Raises:
            ValueError: the path is empty, outside the served volumes, or a
                directory. Directories are never removed by this port: one bad
                path could otherwise take a whole folder of uploads with it.
        """
        ...
