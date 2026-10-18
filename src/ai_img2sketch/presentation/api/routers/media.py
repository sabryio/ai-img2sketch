"""Client-file staging endpoint.

A desktop shell can pass a host path and let the container's mounts make it
readable. A browser cannot — the file it picked exists only as bytes — so this
endpoint writes those bytes into the media volume and answers with a path the
backend can open. That is the whole job: it stores, it does not generate.

Error mapping matches the sketch endpoints: a well-formed payload with an
unusable file (wrong type, empty, oversized, corrupt base64) is a ``422``.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging

from fastapi import APIRouter, HTTPException

from ....application.ports.blob_store import BlobStore
from ..schemas import StoredMedia, StoreMediaRequest

logger = logging.getLogger(__name__)

_STATUS_UNPROCESSABLE = 422

#: Ceiling for one decoded upload: a photo, never a video.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def _unusable(detail: str) -> HTTPException:
    """422 — well-formed request, unusable content."""
    return HTTPException(status_code=_STATUS_UNPROCESSABLE, detail=detail)


def create_media_router(store: BlobStore) -> APIRouter:
    """Build the media router around a blob store (the write port)."""
    router = APIRouter(tags=["media"])

    @router.post(
        path="/media",
        response_model=StoredMedia,
        summary="Stage an image so the backend can read it",
    )
    async def store_media(request: StoreMediaRequest) -> StoredMedia:
        try:
            content = base64.b64decode(request.content_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise _unusable(f"Invalid base64 payload: {exc}") from exc

        if len(content) > MAX_UPLOAD_BYTES:
            raise _unusable(f"File too large: {len(content)} bytes (limit {MAX_UPLOAD_BYTES})")

        try:
            path = await asyncio.to_thread(
                store.store, request.filename, content, request.directory
            )
        except ValueError as exc:
            raise _unusable(str(exc)) from exc

        logger.info("Stored upload %s (%d bytes)", path, len(content))
        return StoredMedia(path=str(path))

    return router
