# Tauri Integration Guide

## Overview

The AI-Img2Sketch backend ships as a FastAPI service (REST + Server-Sent
Events) that is containerized with Docker. This guide explains how a Tauri app
starts, locates, and talks to it — including the Docker-not-running case.

## Architecture

- **Backend**: FastAPI server (`ai_img2sketch.presentation.api.app:app`),
  containerized, listening on port 8000.
- **REST**: endpoints under `/api/v1/` (see the table below).
- **Event stream**: SSE at `/api/v1/events` mirroring the REST lifecycle.
- **CORS**: pre-configured for Tauri webview origins:
  `http://localhost:1420`, `http://tauri.localhost`, `tauri://localhost`.

## Starting the Backend

### Option 1: Docker Compose (recommended)

```bash
cd /path/to/ai-img2sketch
docker compose up -d     # or: img2sketch... see BackendManager below
```

The compose stack binds `127.0.0.1:8000` (localhost only, the webview is on the
same machine) and reports health at `/api/v1/health`.

### Option 2: Docker directly

```bash
docker build -t ai-img2sketch-api .
docker run -p 127.0.0.1:8000:8000 ai-img2sketch-api
```

### Option 3: Local development (no Docker)

```bash
uv sync                      # once
uv run img2sketch-api        # or: uv run uvicorn ai_img2sketch.presentation.api.app:app --reload
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/v1/health` | GET | Liveness probe (`{"status": "ok"}`) |
| `/api/v1/sketches` | POST | Generate one sketch video from an image |
| `/api/v1/sketches/batch` | POST | Generate one video per image in a directory |
| `/api/v1/events` | GET | SSE stream of `sketch.*` / `batch.*` lifecycle events |

### Request example

```typescript
const response = await fetch("http://localhost:8000/api/v1/sketches", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    image_path: "/app/media/photo.jpg", // a path INSIDE the container (see Volumes)
    output_dir: "/app/output",
    config: { split_len: 16, object_skip_rate: 8 },
  }),
});
const result = await response.json(); // { output_path: "/app/output/photo.mp4" }
```

### Error mapping (shared by the SSE failure events)

| Status | Meaning |
|---|---|
| `404` | Image or directory does not exist |
| `422` | Valid JSON, unusable content (unreadable image, folder without supported images, bad option ranges) |
| `500` | Unexpected failure (message surfaced verbatim for local debugging) |

## Volumes: paths in requests must exist inside the container

The compose file mounts `./media` → `/app/media` (client files) and
`./output` → `/app/output` (generated videos). Reference those container paths
in `image_path` / `input_dir` / `output_dir`.

## SSE Event Streaming

`GET /api/v1/events` follows a classic lifecycle:

1. **Initial frames** — sent immediately on connect:
   `retry: 5000` (reconnect hint) then `: connected` (unnamed ack comment).
2. **Message events** — one frame per application event:

   ```
   event: sketch.completed
   id: 0
   data: {"image": "/app/media/a.jpg", "output_path": "/app/output/a.mp4"}
   ```

   Event names: `sketch.started` / `sketch.completed` / `sketch.failed` and
   `batch.started` / `batch.completed` / `batch.failed` — the same names and
   payload fields the REST responses use.
3. **Keep-alives** — during silence (>15 s) an anonymous `: keep-alive`
   comment keeps proxies and the webview from timing out.
4. **Close event** — when the backend shuts down: `event: close`, then the
   stream ends.

### Frontend usage

```typescript
const source = new EventSource("http://localhost:8000/api/v1/events");

for (const name of [
  "sketch.started",
  "sketch.completed",
  "sketch.failed",
  "batch.started",
  "batch.completed",
  "batch.failed",
]) {
  source.addEventListener(name, (event) => {
    const data = JSON.parse((event as MessageEvent).data);
    console.log(name, data);
  });
}

source.onopen = () => console.log("stream attached");
source.onerror = () => console.warn("connection lost; browser retries (see retry)");
```

## Starting the Backend from Tauri

`ai_img2sketch.infrastructure.tauri.backend_client` (packaged with the app)
wraps the Docker plumbing:

```python
from ai_img2sketch.infrastructure.tauri.backend_client import (
    BackendManager,
    is_backend_reachable,
)

manager = BackendManager(compose_file=Path("docker-compose.yml"))
handle = manager.start()          # raises RuntimeError if Docker is not running
if not is_backend_reachable(handle):
    ...
...
manager.stop()                    # docker compose down
```

`handle.base_url` is `http://localhost:8000` as reachable from the same machine.

## Handling the Case Where Docker Is Not Running

`BackendManager.start()` raises `RuntimeError("Docker is not running…")` when
`docker info` fails (daemon down or Docker not installed). Decide the fallback
in the shell:

1. **Detect** — guard every startup with `manager.is_docker_running()`.
2. **Inform** — surface the message ("Start Docker Desktop and try again").
3. **Fallback** — offer running the backend without Docker
   (`img2sketch-api`), which is the same server on port 8000.
4. **Verify** — after start, poll `/api/v1/health` (compose has its own
   healthcheck and `restart: unless-stopped`).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `APP_HOST` | `0.0.0.0` | Bind host |
| `APP_PORT` | `8000` | Bind port |
| `APP_LOG_LEVEL` | `info` | uvicorn log level |
| `APP_CORS_ORIGINS` | Tauri origins | JSON list of allowed CORS origins |

## Health Checks

The image defines a `HEALTHCHECK` (urllib ping of `/api/v1/health`, with a
start period) and compose repeats it. In the Tauri shell, gate the first API
call on a successful `/api/v1/health` response.

## Dependency Direction (Clean Architecture)

The FastAPI layer (interface adapters in `presentation/api`) depends on the
application layer (use cases, ports) and never the reverse; business logic
stays in `domain`/`application`. SSE transport, Docker helpers, and settings
loading are infrastructure adapters behind the `EventPublisher`/`EventStream`
ports.
