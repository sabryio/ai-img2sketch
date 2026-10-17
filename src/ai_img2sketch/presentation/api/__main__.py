"""Console entry point running the API server (``img2sketch-api``)."""

from __future__ import annotations

import uvicorn

from ...infrastructure.config.settings import load_settings
from .app import create_app


def main() -> None:
    """Run the sketch API server with settings from the environment."""
    settings = load_settings()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    main()
