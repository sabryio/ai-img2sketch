"""Interface adapters: FastAPI routers in front of the application use cases.

Every router is built by a factory that receives its dependencies (ports and
composition-root factories). No business logic lives here: request DTOs are
translated into domain objects, use cases are invoked, and errors are mapped to
HTTP responses — the same mapping the SSE events use.
"""

from __future__ import annotations

from .artifacts import create_artifacts_router
from .events import create_events_router
from .health import create_health_router
from .media import create_media_router
from .sketches import create_sketches_router

__all__ = [
    "create_artifacts_router",
    "create_events_router",
    "create_health_router",
    "create_media_router",
    "create_sketches_router",
]
