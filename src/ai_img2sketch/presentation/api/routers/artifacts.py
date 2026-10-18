"""Artifact endpoints: hand a produced file over, or discard it.

A produced video is written inside the backend's volumes. A browser or desktop
shell cannot read those paths, so the download endpoint hands the bytes over and
the delete endpoint is how a client says it has them and wants nothing kept. The
two share one containment rule: only the volumes the API writes to are reachable
(see
:class:`~ai_img2sketch.infrastructure.storage.volume_artifacts.VolumeArtifacts`).

Error mapping matches the sketch endpoints:

- ``404`` — nothing exists at that path (download only; delete is idempotent)
- ``422`` — the path is empty, a directory, or outside the served volumes
"""

from __future__ import annotations

import asyncio
import logging
import mimetypes
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse

from ....application.ports.artifact_reader import ArtifactReader
from ....application.ports.artifact_remover import ArtifactRemover

logger = logging.getLogger(__name__)

_STATUS_NOT_FOUND = 404
_STATUS_UNPROCESSABLE = 422
_STATUS_NO_CONTENT = 204

#: A download is opaque on purpose: the client decides what to do with the bytes.
_DOWNLOAD_MEDIA_TYPE = "application/octet-stream"

Disposition = Literal["attachment", "inline"]


def _media_type_for(path: str, disposition: Disposition) -> str:
    """Pick the media type for a served file.

    An attachment is always opaque (the browser saves it either way). An inline
    file is played or shown by the browser, which needs the real type: a video
    served as ``application/octet-stream`` is not played.
    """
    if disposition == "attachment":
        return _DOWNLOAD_MEDIA_TYPE
    guessed, _ = mimetypes.guess_type(path)
    return guessed or _DOWNLOAD_MEDIA_TYPE


def create_artifacts_router(reader: ArtifactReader, remover: ArtifactRemover) -> APIRouter:
    """Build the artifacts router around the read and delete ports.

    The same adapter usually satisfies both, but the router asks for exactly the
    role each route needs.
    """
    router = APIRouter(tags=["artifacts"])

    @router.get(
        path="/artifacts/download",
        summary="Download a produced file by the path the backend reported",
        response_class=FileResponse,
    )
    async def download_artifact(
        path: str = Query(description="Path as the backend reported it"),
        disposition: Disposition = Query(
            default="attachment",
            description=(
                "'attachment' saves the file under its name; 'inline' streams it, "
                "which is what a video preview needs"
            ),
        ),
    ) -> FileResponse:
        try:
            # `resolve` stats the filesystem; keep it off the event loop.
            resolved = await asyncio.to_thread(reader.resolve, path)
        except ValueError as exc:
            raise HTTPException(status_code=_STATUS_UNPROCESSABLE, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=_STATUS_NOT_FOUND, detail=str(exc)) from exc

        logger.info("Serving artifact %s (%s)", resolved, disposition)
        return FileResponse(
            path=resolved,
            media_type=_media_type_for(str(resolved), disposition),
            filename=resolved.name,
            content_disposition_type=disposition,
        )

    @router.delete(
        path="/artifacts",
        status_code=_STATUS_NO_CONTENT,
        summary="Delete a file the API staged or produced",
    )
    async def delete_artifact(
        path: str = Query(description="Path as the backend reported it"),
    ) -> Response:
        try:
            await asyncio.to_thread(remover.remove, path)
        except ValueError as exc:
            raise HTTPException(status_code=_STATUS_UNPROCESSABLE, detail=str(exc)) from exc

        logger.info("Removed artifact %s", path)
        # 204 whether or not the file was still there: deleting is idempotent.
        return Response(status_code=_STATUS_NO_CONTENT)

    return router
