"""JSON-driven object mask loader adapter.

The mask document describes the drawing order of objects. Each entry may point
to a mask image, define a rectangle, or be the catch-all (background) object::

    {
      "objects": [
        {"name": "face", "mask": "face.png", "skip_rate": 4},
        {"name": "sign", "rect": [10, 20, 200, 80]},
        {"name": "background", "skip_rate": 16}
      ]
    }

Paths in ``mask`` are resolved relative to the JSON file itself.
"""

from pathlib import Path

import cv2
import numpy as np
import numpy.typing as npt
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from ...application.ports.object_mask_loader import ObjectMaskLoader
from ...domain.value_objects.dimensions import Dimensions
from ...domain.value_objects.object_mask import ObjectMask


class _ObjectMaskSpec(BaseModel):
    """A single object entry inside a mask document."""

    model_config = ConfigDict(extra="forbid")

    name: str
    mask: str | None = None
    rect: tuple[int, int, int, int] | None = None
    skip_rate: int | None = None

    @field_validator("skip_rate")
    @classmethod
    def _validate_skip_rate(cls, v: int | None) -> int | None:
        if v is not None and v < 1:
            raise ValueError("skip_rate must be >= 1")
        return v


class _ObjectMaskDocument(BaseModel):
    """Top-level mask document."""

    model_config = ConfigDict(extra="forbid")

    objects: list[_ObjectMaskSpec]


class JsonObjectMaskLoader(ObjectMaskLoader):
    """Loads ordered object masks from a JSON document."""

    def load(
        self,
        mask_path: Path,
        source_dimensions: Dimensions,
        target_dimensions: Dimensions,
    ) -> list[ObjectMask]:
        """Load and validate objects from ``mask_path``."""
        if not mask_path.exists():
            raise FileNotFoundError(f"Object mask file not found: {mask_path}")

        try:
            document = _ObjectMaskDocument.model_validate_json(
                mask_path.read_text(encoding="utf-8")
            )
        except ValidationError as exc:
            raise ValueError(f"Invalid object mask file '{mask_path}': {exc}") from exc

        if not document.objects:
            raise ValueError(f"Object mask file '{mask_path}' defines no objects")

        base_dir = mask_path.parent
        return [
            ObjectMask(
                name=spec.name,
                region=self._build_region(spec, base_dir, source_dimensions, target_dimensions),
                skip_rate=spec.skip_rate,
            )
            for spec in document.objects
        ]

    def _build_region(
        self,
        spec: _ObjectMaskSpec,
        base_dir: Path,
        source_dimensions: Dimensions,
        target_dimensions: Dimensions,
    ) -> npt.NDArray[np.bool_] | None:
        """Build the boolean region for one object spec."""
        if spec.mask is not None and spec.rect is not None:
            raise ValueError(f"Object '{spec.name}' cannot define both 'mask' and 'rect'")

        if spec.mask is not None:
            return self._region_from_mask(base_dir / spec.mask, target_dimensions, spec.name)

        if spec.rect is not None:
            return self._region_from_rect(spec.rect, source_dimensions, target_dimensions)

        # No mask/rect: catch-all/background object.
        return None

    @staticmethod
    def _region_from_mask(
        mask_path: Path, target_dimensions: Dimensions, name: str
    ) -> npt.NDArray[np.bool_]:
        """Load a mask image and binarize it at the target size."""
        data = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
        if data is None:
            raise FileNotFoundError(f"Mask image for object '{name}' not found: {mask_path}")
        resized = cv2.resize(
            data,
            (target_dimensions.width, target_dimensions.height),
            interpolation=cv2.INTER_NEAREST,
        )
        return resized > 0

    @staticmethod
    def _region_from_rect(
        rect: tuple[int, int, int, int],
        source_dimensions: Dimensions,
        target_dimensions: Dimensions,
    ) -> npt.NDArray[np.bool_]:
        """Build a boolean region from an (x, y, width, height) source rectangle."""
        x, y, width, height = rect
        scale_x = target_dimensions.width / source_dimensions.width
        scale_y = target_dimensions.height / source_dimensions.height

        x_start = max(0, round(x * scale_x))
        y_start = max(0, round(y * scale_y))
        x_end = min(target_dimensions.width, round((x + width) * scale_x))
        y_end = min(target_dimensions.height, round((y + height) * scale_y))

        region = np.zeros((target_dimensions.height, target_dimensions.width), dtype=np.bool_)
        if x_end > x_start and y_end > y_start:
            region[y_start:y_end, x_start:x_end] = True
        return region
