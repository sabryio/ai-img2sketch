"""Server configuration, loaded from environment variables.

Keeping configuration at the infrastructure edge means the Docker/Tauri wiring
controls host, port and origins without code changes. Defaults favour the
Tauri webview on localhost.
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Origins the Tauri webview uses when talking to this service.
_DEFAULT_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:1420",  # Tauri dev server (Vite default port)
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


def load_settings() -> ApiSettings:
    """Load :class:`ApiSettings` from the current environment."""
    return ApiSettings()
