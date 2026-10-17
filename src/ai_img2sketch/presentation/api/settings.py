"""Runtime configuration shared by the interface adapters.

``ApiSettings`` reads environment variables (see :mod:`infrastructure.config`)
so the container/Tauri wiring controls host, port and CORS origins without code
changes.
"""

from __future__ import annotations

from ...infrastructure.config.settings import ApiSettings, load_settings

__all__ = ["ApiSettings", "load_settings"]
