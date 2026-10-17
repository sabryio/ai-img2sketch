"""Sketch generation endpoints.

Handlers translate request DTOs into domain objects and invoke the use cases
from the composition root, so no business logic lives in the HTTP layer.
Execution runs in a worker thread (OpenCV + frame writing are blocking), and
``sketch.*`` / ``batch.*`` lifecycle events are published on the event loop.

Error mapping (shared with the SSE ``sketch.failed`` / ``batch.failed`` events):

- ``404`` — the referenced image or input directory does not exist
- ``422`` — the payload is valid JSON but the content is unusable
  (e.g. an unreadable image, a folder without supported images)
- ``500`` — unexpected failure (message surfaced verbatim for local debugging)
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ....application.ports.event_publisher import EventPublisher
from ....application.services.video_path_resolver import VideoPathResolver
from ....application.use_cases.generate_batch_videos import BatchSummary
from ....domain.value_objects.video_config import VideoConfig
from ...bundled import BundledHandPaths, bundled_hand_paths
from ...composition import (
    build_generate_sketch_video_use_case,
    build_generate_videos_from_directory_use_case,
    create_image_loader,
)
from ..schemas import (
    BatchSketchItem,
    BatchSketchRequest,
    BatchSketchResult,
    SketchOptions,
    SketchRequest,
    SketchResult,
)

logger = logging.getLogger(__name__)

_STATUS_NOT_FOUND = 404
_STATUS_UNPROCESSABLE = 422
_STATUS_ERROR = 500


def _video_config(options: SketchOptions) -> VideoConfig:
    """Translate request options into the domain configuration."""
    settings = options.model_dump(exclude_none=True)
    return VideoConfig(**settings)


def _missing_asset(path: Path, label: str) -> HTTPException:
    """404 — a referenced asset (image, directory or hand file) does not exist."""
    return HTTPException(status_code=_STATUS_NOT_FOUND, detail=f"{label} not found: {path}")


def _missing_image(image_path: Path) -> HTTPException:
    """404 — the referenced source image does not exist."""
    return _missing_asset(image_path, "Image")


def _hand_assets(hand_image_path: str | None, hand_mask_path: str | None) -> BundledHandPaths:
    """Resolve the drawing-hand assets: request paths or the bundled ones.

    Explicit paths are validated up front so a bad custom asset fails as a
    clean, labelled ``404`` instead of surfacing from inside the use case.
    """
    bundled = bundled_hand_paths()
    image = Path(hand_image_path) if hand_image_path else bundled.image
    mask = Path(hand_mask_path) if hand_mask_path else bundled.mask
    if not image.is_file():
        raise _missing_asset(image, "Hand image")
    if not mask.is_file():
        raise _missing_asset(mask, "Hand mask")
    return BundledHandPaths(image=image, mask=mask)


def _missing_directory(directory: Path) -> HTTPException:
    """404 — the referenced directory does not exist."""
    return _missing_asset(directory, "Directory")


def _unusable(exc: Exception) -> HTTPException:
    """422 — valid request, unusable content."""
    return HTTPException(status_code=_STATUS_UNPROCESSABLE, detail=str(exc))


def _unexpected(exc: Exception) -> HTTPException:
    """500 — unexpected failure; logged server-side and surfaced verbatim."""
    detail = str(exc)
    logger.error("Generation failed (%s)", detail, exc_info=exc)
    return HTTPException(status_code=_STATUS_ERROR, detail=detail)


async def _publish_failure(
    publisher: EventPublisher,
    event: str,
    payload: dict[str, object],
    exc: Exception,
) -> HTTPException:
    """Publish ``<event>.failed`` and map ``exc`` to its HTTP exception.

    Single source of truth for error handling: both endpoints funnel every
    failure through here, so the JSON status codes and the SSE failure events
    can never drift apart (see the module docstring for the mapping).
    """
    payload["error"] = str(exc)
    await publisher.publish(f"{event}.failed", payload)
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=_STATUS_NOT_FOUND, detail=str(exc))
    if isinstance(exc, ValueError):
        return _unusable(exc)
    return _unexpected(exc)


def create_sketches_router(publisher: EventPublisher) -> APIRouter:
    """Build the sketches router. ``publisher`` is the event-bus write port."""
    router = APIRouter(tags=["sketches"])

    @router.post(
        path="/sketches",
        response_model=SketchResult,
        summary="Generate one sketch video from an image",
    )
    async def generate_sketch(request: SketchRequest) -> SketchResult:
        image_path = Path(request.image_path)
        if not image_path.is_file():
            raise _missing_image(image_path)

        hand_paths = _hand_assets(request.hand_image_path, request.hand_mask_path)
        loader = create_image_loader()
        use_case = build_generate_sketch_video_use_case(
            hand_image_path=hand_paths.image,
            hand_mask_path=hand_paths.mask,
        )
        output_path = await asyncio.to_thread(
            VideoPathResolver().resolve,
            image_path,
            Path(request.output_dir) if request.output_dir else None,
        )
        payload: dict[str, object] = {
            "image": str(image_path),
            "output_path": str(output_path),
        }
        await publisher.publish("sketch.started", payload)

        try:
            image = await asyncio.to_thread(loader.load, image_path)
            produced = await asyncio.to_thread(
                use_case.execute,
                image,
                _video_config(request.config),
                output_path=output_path,
                object_mask_path=(
                    Path(request.object_mask_path) if request.object_mask_path else None
                ),
            )
        except Exception as exc:
            raise await _publish_failure(publisher, "sketch", payload, exc) from exc

        await publisher.publish("sketch.completed", payload)
        return SketchResult(output_path=str(produced))

    @router.post(
        path="/sketches/batch",
        response_model=BatchSketchResult,
        summary="Generate one sketch video per image in a directory",
    )
    async def generate_batch(request: BatchSketchRequest) -> BatchSketchResult:
        input_dir = Path(request.input_dir)
        if not input_dir.is_dir():
            raise _missing_directory(input_dir)

        hand_paths = _hand_assets(request.hand_image_path, request.hand_mask_path)
        use_case = build_generate_videos_from_directory_use_case(
            hand_image_path=hand_paths.image,
            hand_mask_path=hand_paths.mask,
        )
        mask_path = Path(request.object_mask_path) if request.object_mask_path else None
        payload: dict[str, object] = {"input_dir": str(input_dir)}
        await publisher.publish("batch.started", payload)

        try:
            summary: BatchSummary = await asyncio.to_thread(
                use_case.execute,
                input_dir,
                _video_config(request.config),
                output_directory=(Path(request.output_dir) if request.output_dir else None),
                object_mask_path=mask_path,
            )
        except Exception as exc:  # mapped to 404/422/500 and published as batch.failed
            raise await _publish_failure(publisher, "batch", payload, exc) from exc

        completed: dict[str, object] = {
            "input_dir": str(input_dir),
            "succeeded": len(summary.succeeded),
            "failed": len(summary.failed),
        }
        await publisher.publish("batch.completed", completed)

        items = [
            BatchSketchItem(
                image=str(item.image_path),
                output_path=str(item.output_path) if item.output_path else None,
                error=item.error,
            )
            for item in summary.items
        ]
        return BatchSketchResult(input_dir=str(input_dir), items=items)

    return router
