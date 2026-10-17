"""Health router."""

from __future__ import annotations

from fastapi import APIRouter

from ..schemas import HealthResponse


def create_health_router() -> APIRouter:
    """Build the health router (used by Docker and the Tauri shell)."""
    router = APIRouter(tags=["health"])

    @router.get(path="/health", response_model=HealthResponse, summary="Liveness probe")
    async def health() -> HealthResponse:
        """Report that the service is up."""
        return HealthResponse()

    return router
