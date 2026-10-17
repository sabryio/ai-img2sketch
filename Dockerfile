# syntax=docker/dockerfile:1

# ---- Builder -------------------------------------------------------------
# All heavy work (compile, wheel build) happens here; only the finished
# virtual environment is copied into the final image.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

WORKDIR /app

# Lockfile first for better layer caching.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-editable

# ---- Runtime -------------------------------------------------------------
FROM python:3.12-slim

# System libraries the bundled OpenCV wheels need at import time.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libglib2.0-0 \
       libgl1 \
       libsm6 \
       libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Non-root user; output folders are made writable for the mounted volumes.
RUN useradd --create-home --uid 10001 sketch

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    APP_HOST=0.0.0.0 \
    APP_PORT=8000

# Writable scratch space for generated videos and client files.
RUN mkdir -p /app/output /app/media \
    && chown -R sketch:sketch /app/output /app/media

USER sketch

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=3)"]

# Single worker on purpose: the event bus is in-process, so SSE subscribers
# and request handlers must share one event loop.
CMD ["uvicorn", "ai_img2sketch.presentation.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
