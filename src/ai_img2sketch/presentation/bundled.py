"""Bundled package resources shared by the interface adapters (CLI, API)."""

from __future__ import annotations

from dataclasses import dataclass
from importlib import resources
from pathlib import Path


@dataclass(frozen=True)
class BundledHandPaths:
    """Locations of the drawing-hand assets shipped inside the package."""

    image: Path
    mask: Path


def bundled_hand_paths() -> BundledHandPaths:
    """Resolve the drawing-hand image and mask bundled with the package."""
    root = Path(str(resources.files("ai_img2sketch.resources.images")))
    return BundledHandPaths(image=root / "drawing-hand.png", mask=root / "hand-mask.png")
