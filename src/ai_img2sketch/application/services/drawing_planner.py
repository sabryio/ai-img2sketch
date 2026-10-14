"""Plans the order in which grid cells are drawn, honouring object masks."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from ...domain.value_objects.dimensions import Dimensions
from ...domain.value_objects.object_mask import ObjectMask


@dataclass(frozen=True, slots=True)
class DrawingGroup:
    """A set of grid cells that share a drawing label and skip rate."""

    label: str
    cells: npt.NDArray[np.int_]
    skip_rate: int


class DrawingPlanner:
    """Groups black grid cells into ordered drawing groups.

    With no object masks the whole image is one group. With masks, each object's
    cells form their own group (in document order), followed by any leftover
    "background" cells.
    """

    IMAGE_LABEL = "image"
    BACKGROUND_LABEL = "background"

    def plan(
        self,
        black_cells: npt.NDArray[np.int_],
        object_masks: list[ObjectMask],
        dimensions: Dimensions,
        split_len: int,
        default_skip_rate: int,
    ) -> list[DrawingGroup]:
        """Return the ordered drawing groups for the given black cells."""
        if not object_masks:
            return [DrawingGroup(self.IMAGE_LABEL, black_cells, default_skip_rate)]

        object_id_map, background_index = self._build_object_id_map(object_masks, dimensions)

        buckets: dict[int, list[npt.NDArray[np.int_]]] = {}
        for cell in black_cells:
            object_id = self._classify_cell(cell, object_id_map, split_len)
            if object_id < 0 and background_index is not None:
                object_id = background_index
            buckets.setdefault(object_id, []).append(cell)

        groups: list[DrawingGroup] = []
        for index, obj in enumerate(object_masks):
            cells = buckets.get(index)
            if cells:
                skip_rate = obj.skip_rate if obj.skip_rate is not None else default_skip_rate
                groups.append(DrawingGroup(obj.name, np.array(cells), skip_rate))

        leftovers = buckets.get(-1)
        if leftovers:
            groups.append(
                DrawingGroup(self.BACKGROUND_LABEL, np.array(leftovers), default_skip_rate)
            )

        return groups

    @staticmethod
    def _build_object_id_map(
        object_masks: list[ObjectMask], dimensions: Dimensions
    ) -> tuple[npt.NDArray[np.int64], int | None]:
        """Build a per-pixel object-id map and locate the catch-all object, if any."""
        object_id_map = np.full((dimensions.height, dimensions.width), -1, dtype=np.int64)
        background_index: int | None = None
        for index, obj in enumerate(object_masks):
            if obj.region is None:
                background_index = index
            else:
                object_id_map[obj.region] = index
        return object_id_map, background_index

    @staticmethod
    def _classify_cell(
        cell: npt.NDArray[np.int_], object_id_map: npt.NDArray[np.int64], split_len: int
    ) -> int:
        """Return the object id owning the majority of a cell, or ``-1`` if unowned."""
        v_start = int(cell[0]) * split_len
        h_start = int(cell[1]) * split_len
        cell_ids = object_id_map[v_start : v_start + split_len, h_start : h_start + split_len]
        cell_ids = cell_ids.ravel()
        cell_ids = cell_ids[cell_ids >= 0]
        if cell_ids.size == 0:
            return -1
        counts = np.bincount(cell_ids)
        return int(np.argmax(counts))
