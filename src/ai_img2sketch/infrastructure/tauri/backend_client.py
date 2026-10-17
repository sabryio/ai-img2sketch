"""Helpers for starting and probing the Dockerized backend from a shell.

The Tauri shell (or an operator script) can use these to bring the API up and
to decide whether it is reachable. They know nothing about sketch generation.
"""

from __future__ import annotations

import logging
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

_DEFAULT_PORT = 8000


@dataclass(frozen=True)
class BackendHandle:
    """Where the backend was started and how it is reachable."""

    host: str = "localhost"
    port: int = _DEFAULT_PORT

    @property
    def base_url(self) -> str:
        """Base URL of the API, as reachable from the same machine."""
        return f"http://{self.host}:{self.port}"

    def health_url(self) -> str:
        """URL of the health endpoint."""
        return f"{self.base_url}/api/v1/health"


class BackendManager:
    """Bring the ``docker compose`` backend up and down.

    Raises :class:`RuntimeError` when Docker itself is unavailable, so callers
    can tell the user to start Docker Desktop before retrying.
    """

    def __init__(self, compose_file: Path = Path("docker-compose.yml")) -> None:
        self._compose_file = compose_file

    def is_docker_running(self) -> bool:
        """Whether the Docker daemon answers ``docker info``."""
        try:
            result = subprocess.run(
                ["docker", "info"],
                capture_output=True,
                timeout=5,
                check=False,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False
        return result.returncode == 0

    def start(self, host: str = "localhost", port: int = _DEFAULT_PORT) -> BackendHandle:
        """Start (or leave running) the backend and return where to call it."""
        if not self.is_docker_running():
            raise RuntimeError(
                "Docker is not running. Start Docker Desktop and try again, or "
                "launch the backend directly with: img2sketch-api"
            )
        result = subprocess.run(
            [
                "docker",
                "compose",
                "-f",
                str(self._compose_file),
                "up",
                "-d",
            ],
            capture_output=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            detail = result.stderr.decode(errors="replace").strip()
            raise RuntimeError(f"docker compose up failed: {detail}")
        logger.info("Backend compose stack is up (port %s)", port)
        return BackendHandle(host=host, port=port)

    def stop(self) -> None:
        """Stop the compose stack."""
        result = subprocess.run(
            ["docker", "compose", "-f", str(self._compose_file), "down"],
            capture_output=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            detail = result.stderr.decode(errors="replace").strip()
            raise RuntimeError(f"docker compose down failed: {detail}")


def is_backend_reachable(handle: BackendHandle) -> bool:
    """Whether the backend's health endpoint answers."""
    try:
        with urllib.request.urlopen(handle.health_url(), timeout=5) as response:
            return response.getcode() == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False
