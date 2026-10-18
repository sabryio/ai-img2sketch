# Tauri Integration Guide

## Overview

The AI-Img2Sketch backend ships as a FastAPI service (REST + Server-Sent
Events) that is containerized with Docker. This guide explains how a Tauri app
starts, locates, and talks to it — including the Docker-not-running case.

## Architecture

- **Backend**: FastAPI server (`ai_img2sketch.presentation.api.app:app`),
  containerized or shipped as the `img2sketch-api` sidecar binary, listening on
  port 8000. Runs a **single worker on purpose** — the SSE bus is in-process.
- **REST**: endpoints under `/api/v1/` (see the table below).
- **Event stream**: SSE at `/api/v1/events` mirroring the REST lifecycle.
- **CORS**: pre-configured for the Tauri webview origins and the `frontend/`
  dev server: `http://localhost:1420`, `http://localhost:3000`,
  `http://127.0.0.1:3000`, `http://tauri.localhost`, `tauri://localhost`.

## Starting the Backend

Pick the strategy that fits the app release. The Dockerized service and the
sidecar binary are the **same server** — endpoints and settings identical.

### Option A: `img2sketch-api` as a Tauri sidecar (simplest)

The wheel installs an `img2sketch-api` executable. Bundle PyInstaller-compiled
(or otherwise distributed) binary as a Tauri `externalBin` and Tauri's Rust core
starts/stops it with the app — no Docker on the user's machine:

```json
{
  "bundle": {
    "externalBin": ["binaries/img2sketch-api"]
  }
}
```

```typescript
// spawn it once at boot (Rust: tauri_plugin_shell / Command::new_sidecar)
// then talk to http://127.0.0.1:8000 from the webview
```

Use `APP_HOST` / `APP_PORT` to keep the port configurable, and gate the UI on
the `/api/v1/health` probe (see "Recommended lifecycle").

### Option B: Docker Compose

```bash
cd /path/to/ai-img2sketch
docker compose up -d
```

The compose stack binds `127.0.0.1:8000` (localhost only, the webview is on the
same machine) and reports health at `/api/v1/health`. Files travel over HTTP:
uploads go in with `POST /api/v1/media`, results come back out with
`GET /api/v1/artifacts/download`.

### Option C: Local development (no Docker, no packaging)

```bash
uv sync                      # once
uv run img2sketch-api        # or: uv run uvicorn ai_img2sketch.presentation.api.app:app --reload
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/v1/health` | GET | Liveness probe (`{"status": "ok"}`) |
| `/api/v1/media` | POST | Stage a client-uploaded image so the backend can read it |
| `/api/v1/artifacts/download` | GET | Fetch a produced video by the path the backend reported |
| `/api/v1/artifacts` | DELETE | Drop a staged upload or a produced video |
| `/api/v1/sketches` | POST | Generate one sketch video from an image |
| `/api/v1/sketches/batch` | POST | Generate one video per image in a directory |
| `/api/v1/events` | GET | SSE stream of `sketch.*` / `batch.*` lifecycle and progress events |

### Request example

```typescript
const response = await fetch("http://localhost:8000/api/v1/sketches", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    image_path: "/app/media/photo.jpg", // a path INSIDE the container (see Volumes)
    output_dir: "/app/output",
    config: {
      frame_rate: 25,           // 1-120 fps
      split_len: 16,            // 1-100 grid split length
      object_skip_rate: 8,      // 1-100 skip rate for drawing
      draw_duration_sec: 5.0,   // 0.1-600 s, overrides object_skip_rate
      end_duration_sec: 2,      // 0-10 s final hold
      black_pixel_threshold: 10, // 0-255
    },
    object_mask_path: "/app/media/masks.json",  // optional
    hand_image_path: "/app/media/my-hand.png",  // optional, else bundled assets
    hand_mask_path: "/app/media/my-hand-mask.png", // optional, else bundled assets
  }),
});
const result = await response.json(); // { output_path: "/app/output/photo.mp4" }
```

### Batch request example

```typescript
const response = await fetch("http://localhost:8000/api/v1/sketches/batch", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    input_dir: "/app/media/photos", // folder of images (inside the container)
    output_dir: "/app/output",
    config: { split_len: 16 },      // same fields as the single request
    object_mask_path: "/app/media/masks.json",   // one masks file for the folder
    hand_image_path: "/app/media/my-hand.png",   // optional, else bundled assets
    hand_mask_path: "/app/media/my-hand-mask.png", // optional, else bundled assets
  }),
});
const result = await response.json();
// { input_dir, items: [{ image, output_path | null, error | null }, ...] }
```

### Defaults and parity

Every field is optional apart from the input path; anything omitted falls back
to the same defaults the CLI uses (frame rate 25, split 10, skip 8, end hold
2 s, threshold 10, bundled drawing hand). The API is a **superset** of the CLI
options — `black_pixel_threshold` was previously CLI-internal only. Nothing
generation-related lives only in the CLI any more, so a future release can drop
the CLI and the Tauri app loses nothing.

### Error mapping (shared by the SSE failure events)

| Status | Meaning |
|---|---|
| `404` | Image or directory does not exist |
| `422` | Valid JSON, unusable content (unreadable image, folder without supported images, bad option ranges) |
| `500` | Unexpected failure (message surfaced verbatim for local debugging) |

## Paths: requests must reference files the backend owns

The compose stack mounts **nothing** from the host. `POST /api/v1/media` copies
the bytes into `<APP_MEDIA_DIR>/uploads` (in the container: `/app/media/uploads`)
and answers with the path they landed on; that path is what
`image_path` / `input_dir` / object-mask and hand-image fields must carry.

Nothing else is readable, so a typed host path is uploaded first: the desktop
app reads the picked file with `tauri-plugin-fs` and sends it, a browser sends
the bytes it was handed. See "Picking files" in `frontend/README.md`.

The same applies in the other direction. A folder the container does not own
cannot be written by it, so the desktop shell renders beside the image (no
`output_dir` sent), fetches the video from
`GET /api/v1/artifacts/download`, and writes it into the requested host folder
with `tauri-plugin-fs` — or saves it through the native save dialog when the user
asks for one file. Produced files can be dropped again with
`DELETE /api/v1/artifacts`, and the container's directories are `tmpfs`, so a
restart clears whatever is left.

## SSE Event Streaming

`GET /api/v1/events` speaks the oRPC `asyncIteratorObject` wire format
(`docs/orpc-sse-wire-format.md`) so the frontend can consume it with
`@orpc/client` — or a plain `EventSource`. Lifecycle:

1. **Initial flush** — an anonymous empty comment (`: \n\n`) on connect. The
   route subscribes to the bus before streaming, so nothing published during
   connect is lost.
2. **Message events** — one `data:` frame per event, with a per-connection `id`.
   There is **no `event:` field** (oRPC only decodes the unnamed `message`
   type); the event name is the `"event"` discriminant inside the JSON:

   ```
   id: 0
   data: {"event": "sketch.completed", "image": "/app/media/a.jpg", "output_path": "/app/output/a.mp4"}
   ```

   Discriminants: `sketch.started` / `sketch.progress` / `sketch.completed` /
   `sketch.failed` and `batch.started` / `batch.progress` / `batch.completed` /
   `batch.failed` — the same names and payload fields the REST responses use.
   The `*.progress` frames carry `percent` (whole run), an optional `label`, a
   frame counter and, for a batch, the `item_index` / `item_total` / `item_name`
   of the image being drawn.
3. **Keep-alives** — during silence (>15 s) the bus keep-alive becomes an anonymous
   `: \n\n` comment, so proxies and the webview do not time the stream out.
4. **Close event** — on backend shutdown: `event: close`, then the stream ends.
   No `retry:` hint is sent; oRPC reconnection is manual.

### Frontend usage

```typescript
const source = new EventSource("http://localhost:8000/api/v1/events");

// One handler for every application event — dispatch on the discriminant.
source.onmessage = (message) => {
  const data = JSON.parse(message.data) as { event: string };
  switch (data.event) {
    case "sketch.completed": /* use data.output_path */ break;
    case "sketch.failed":    /* surface data.error */   break;
    // batch.* — parallel shapes from the REST responses
  }
};

source.onopen = () => console.log("stream attached");
source.onerror = () => console.warn("stream lost; reopen explicitly");

// The terminal frame is an explicitly named event.
source.addEventListener("close", () => source.close());

// Close when the app window unloads:
window.addEventListener("beforeunload", () => source.close());
```

Two things the UI should expect right now:

- Events are **lifecycle-level** (started/completed/failed per request). Per-frame
  progress would need the planned `ProgressReporter` port (see
  `ARCHITECTURE.md` → Future Enhancements); design the progress UI around the
  three lifecycle states.
- `sketch.completed` / `batch.completed` arrive **before** the POST response
  returns on fast machines sometimes — use the response as the source of truth
  for navigation and the events as ambient updates for other views.

## Starting the Backend Programmatically (Python helper)

`ai_img2sketch.infrastructure.tauri.backend_client` (packaged with the app)
wraps the Docker plumbing for script-driven or Python-side startup; the Rust
core would normally use the sidecar/compose commands directly:

```python
from pathlib import Path

from ai_img2sketch.infrastructure.tauri.backend_client import (
    BackendManager,
    is_backend_reachable,
)

manager = BackendManager(compose_file=Path("docker-compose.yml"))
handle = manager.start()          # raises RuntimeError if Docker is not running
if not is_backend_reachable(handle):
    ...  # surface "backend is starting, try again shortly" in the UI
...
manager.stop()                    # docker compose down
```

`handle.base_url` is `http://localhost:8000` as reachable from the same machine.

## Recommended Lifecycle in the Tauri App

On app boot:

1. **Reach out** — poll `GET /api/v1/health` until it returns `{"status": "ok"}`.
2. **If unreachable** and the Docker runtime is bundled into the release — start
   the backend (`docker compose up -d` via the shell, or `BackendManager`), then
   poll again.
3. **If Docker is not running/installed** — fall back to the sidecar
   (`img2sketch-api`) or show a clear message ("Start Docker Desktop and try
   again") with a link to the install page.
4. **Subscribe** to `/api/v1/events` once, at app start, and keep it open for
   the whole session.
5. On window close, either leave the container running
   (`restart: unless-stopped` keeps it healthy) or tear it down explicitly
   (`docker compose down` / `manager.stop()`).

## Handling the Case Where Docker Is Not Running

`BackendManager.start()` raises `RuntimeError("Docker is not running…")` when
`docker info` fails (daemon down or Docker not installed). The fallback ladder
in the UI:

1. **Detect** — guard every Docker start with `manager.is_docker_running()`.
2. **Inform** — surface the message ("Start Docker Desktop and try again"),
   ideally with a link to Docker's install page.
3. **Fallback** — offer the sidecar (`img2sketch-api`), which is the same
   server on port 8000 without Docker.
4. **Verify** — after any start, poll `/api/v1/health` until `200` before the
   first generation call.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `APP_HOST` | `0.0.0.0` | Bind host |
| `APP_PORT` | `8000` | Bind port |
| `APP_LOG_LEVEL` | `info` | uvicorn log level |
| `APP_MEDIA_DIR` | `media` | Directory that receives client uploads (`POST /media`) and holds videos written beside their image; the image sets `/app/media` and mounts it as `tmpfs` |
| `APP_OUTPUT_DIR` | `output` | Directory `output_dir` videos are written to and may be downloaded from; the image sets `/app/output`, also `tmpfs` |
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
