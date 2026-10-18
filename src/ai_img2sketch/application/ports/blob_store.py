"""Port for staging client files where the backend can read them.

A desktop shell can hand the backend a host path and let the container's
mounts do the rest. A browser cannot: it only has the bytes of the file the user
picked. This port is the seam that turns those bytes into a path the running
backend can open, whichever interface adapter received them.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol


class BlobStore(Protocol):
    """Writes uploaded bytes into a directory the backend owns."""

    def store(self, filename: str, content: bytes, directory: str | None = None) -> Path:
        """Write ``content`` and return the absolute path it landed on.

        ``filename`` only hints at the name: implementations sanitize it and
        make it unique. ``directory`` is an optional bucket so several uploads
        can share one folder (a batch run needs exactly that).

        Raises:
            ValueError: the name, file type or bucket is not acceptable.
        """
        ...
