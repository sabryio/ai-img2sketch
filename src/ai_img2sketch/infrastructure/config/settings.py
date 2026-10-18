"""Server configuration, loaded from environment variables.

Keeping configuration at the infrastructure edge means the Docker/Tauri wiring
controls host, port and origins without code changes. Defaults favour the
Tauri webview on localhost.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Origins the Tauri webview and the Vite dev server use to reach this service.
_DEFAULT_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:1420",  # Tauri dev server (Vite default port)
    "http://localhost:3000",  # frontend/ dev server (`bun run dev`)
    "http://127.0.0.1:3000",  # same, reached over the loopback alias
    "http://tauri.localhost",  # Tauri webview on Windows/Linux
    "tauri://localhost",  # Tauri webview on macOS
)


class ApiSettings(BaseSettings):
    """Runtime settings for the FastAPI server (``APP_``-prefixed env vars)."""

    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore", populate_by_name=True)

    host: str = Field(default="0.0.0.0", alias="APP_HOST")
    port: int = Field(default=8000, ge=1, le=65535, alias="APP_PORT")
    log_level: str = Field(default="info", alias="APP_LOG_LEVEL")
    cors_origins: list[str] = Field(
        default_factory=lambda: list(_DEFAULT_CORS_ORIGINS),
        alias="APP_CORS_ORIGINS",
        description="JSON list of allowed CORS origins",
    )
    media_dir: Path = Field(
        default=Path("media"),
        alias="APP_MEDIA_DIR",
        description=(
            "Directory that receives client uploads; must be the path the server "
            "can read (the container's /app/media mount)"
        ),
    )


def load_settings() -> ApiSettings:
    """Load :class:`ApiSettings` from the current environment."""
    return ApiSettings()
