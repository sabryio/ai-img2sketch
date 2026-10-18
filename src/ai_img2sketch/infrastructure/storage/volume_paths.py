"""The containment rule shared by every file the API serves or discards.

Uploads land in the media volume and videos in the media or output volume, so
those two roots are the whole of what this API may ever touch. Containment is
checked on the *resolved* path, which means a symlink pointing outside a volume,
or a ``..`` segment, is refused like any other outside path.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path


def resolved_within_volumes(path: str, roots: Sequence[Path]) -> Path:
    """Return ``path`` resolved, or raise when it escapes ``roots``.

    Raises:
        ValueError: the path is empty, or resolves outside every root.
    """
    raw = path.strip()
    if not raw:
        raise ValueError("Empty path")

    resolved = Path(raw).expanduser().resolve()
    if not any(resolved == root or root in resolved.parents for root in roots):
        served = ", ".join(str(root) for root in roots)
        raise ValueError(f"Path is outside the served volumes ({served}): {path}")
    return resolved
