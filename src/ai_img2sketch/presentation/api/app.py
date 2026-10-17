"""FastAPI application factory (a second interface adapter beside the CLI).

``create_app`` is the composition root for HTTP: it builds the settings, event
bus and routers, and nothing in it knows how videos are rendered — that stays
in the application layer behind the use cases. A module-level ``app`` exists so
``uvicorn ai_img2sketch.presentation.api.app:app`` works out of the box.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from importlib import metadata

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ...infrastructure.config.settings import ApiSettings, load_settings
from ...infrastructure.events.async_event_bus import AsyncEventBus
from .routers import create_events_router, create_health_router, create_sketches_router

logger = logging.getLogger(__name__)

#: Single API version prefix; every router mounts under it.
_API_PREFIX = "/api/v1"


def _package_version() -> str:
    """Read the installed package version, with a local fallback."""
    try:
        return metadata.version("ai-img2sketch")
    except metadata.PackageNotFoundError:  # running from an editable tree
        return "0.1.0"


def create_app(settings: ApiSettings | None = None) -> FastAPI:
    """Create the FastAPI app with CORS, routers and a live event bus."""
    settings = settings if settings is not None else load_settings()
    event_bus = AsyncEventBus()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
        logger.info(
            "AI Image to Sketch API listening on http://%s:%s",
            settings.host,
            settings.port,
        )
        yield
        # Wake up every SSE subscriber with the final ``close`` event before
        # the process goes away.
        await event_bus.close()
        logger.info("API shutting down")

    app = FastAPI(
        title="AI Image to Sketch API",
        description=(
            "Generate sketch videos from images. Long operations publish "
            "lifecycle events on the ``/events`` Server-Sent-Events stream."
        ),
        version=_package_version(),
        lifespan=lifespan,
    )
    # The bus is exposed for tests and integrations (e.g. a Tauri sidecar that
    # wants to push events programmatically).
    app.state.event_bus = event_bus
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(create_health_router(), prefix=_API_PREFIX)
    app.include_router(create_sketches_router(publisher=event_bus), prefix=_API_PREFIX)
    app.include_router(create_events_router(event_stream=event_bus), prefix=_API_PREFIX)
    return app


app = create_app()
