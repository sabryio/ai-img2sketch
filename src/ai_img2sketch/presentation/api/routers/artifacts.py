"""Artifact download endpoint.

A produced video is written inside the backend's volumes. A browser or desktop
shell cannot read those paths, so this endpoint hands the bytes over. Reads are
confined to the volumes the API writes to (see
:class:`~...infrastructure.storage.artifact_reader.VolumeArtifactReader`).

Error mapping matches the sketch endpoints:

- ``404`` — nothing exists at that path
- ``422`` — the path is empty, a directory, or outside the served volumes
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from ....application.ports.artifact_reader import ArtifactReader

logger = logging.getLogger(__name__)

_STATUS_NOT_FOUND = 404
_STATUS_UNPROCESSABLE = 422

#: Opaque on purpose: the client decides what to do with the bytes (save them to
#: a chosen folder, hand them to the player), the server only produces them.
_MEDIA_TYPE = "application/octet-stream"


def create_artifacts_router(reader: ArtifactReader) -> APIRouter:
    """Build the artifacts router around a reader (the read port)."""
    router = APIRouter(tags=["artifacts"])

    @router.get(
        path="/artifacts/download",
        summary="Download a produced file by the path the backend reported",
        response_class=FileResponse,
    )
    async def download_artifact(
        path: str = Query(description="Path as the backend reported it"),
    ) -> FileResponse:
        try:
            # `resolve` stats the filesystem; keep it off the event loop.
            resolved = await asyncio.to_thread(reader.resolve, path)
        except ValueError as exc:
            raise HTTPException(status_code=_STATUS_UNPROCESSABLE, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=_STATUS_NOT_FOUND, detail=str(exc)) from exc

        logger.info("Serving artifact %s", resolved)
        return FileResponse(path=resolved, media_type=_MEDIA_TYPE, filename=resolved.name)

    return router
