"""Port for handing a produced file back to a client.

The container writes into its volumes; a browser or desktop shell cannot reach
those paths. This port is the read-side counterpart of ``BlobStore``: it turns a
path the API returned earlier into the bytes a client asked for, without
granting access to anything outside the volumes the API serves.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol


class ArtifactReader(Protocol):
    """Resolves paths the API is allowed to serve back to a client."""

    def resolve(self, path: str) -> Path:
        """Return the readable file at ``path``.

        Raises:
            ValueError: the path is empty, outside the served volumes, or not a
                file (a directory cannot be downloaded).
            FileNotFoundError: nothing exists at that path.
        """
        ...
