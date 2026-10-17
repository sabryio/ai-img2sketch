# AI Image to Sketch — API Reference

Version 1 · Base URL: `http://localhost:8000/api/v1` · All responses are JSON.

The server binds to the host/port set by `APP_HOST` / `APP_PORT` (defaults
`0.0.0.0` / `8000`). Docker Compose binds **`127.0.0.1:8000` only** — the API
is designed for the local machine (e.g. the Tauri webview), not the open
internet.

- **Content type**: requests and responses are `application/json`, except
  `GET /api/v1/events` which streams `text/event-stream`.
- **Validation**: unknown fields are rejected (`422`), field ranges are
  enforced by the schemas below.
- **Single worker by design**: the event bus is in-process, so SSE subscribers
  and request handlers must share one event loop. Scale by running more
  stacks behind a load balancer, not with `--workers`.

---

## Endpoints overview

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness probe used by Docker / the shell |
| `/sketches` | POST | Generate one sketch video from an image |
| `/sketches/batch` | POST | Generate one video per image in a directory |
| `/events` | GET | Server-Sent-Events stream of lifecycle events |

The handlers run generation in a worker thread (OpenCV is blocking), so the
event loop stays responsive during a render and the SSE stream keeps ticking.
The POST requests are **synchronous**: they resolve once the video is on disk.

---

## `GET /api/v1/health`

Response `200`:

```json
{ "status": "ok" }
```

---

## `POST /api/v1/sketches`

Generate a sketch video from a single image. Optional fields fall back to the
same defaults the CLI uses.

### Request body — `SketchRequest`

| Field | Type | Required | Constraints | Default | Notes |
|---|---|---|---|---|---|
| `image_path` | string | yes | non-empty | — | Path to the source image **as visible to the backend** (inside the container: `/app/media/...`) |
| `output_dir` | string | no | non-empty | source image's folder | Directory for the video |
| `config` | `SketchOptions` | no | see below | all defaults | Generation options |
| `object_mask_path` | string | no | non-empty | none | JSON object-mask document for this image |
| `hand_image_path` | string | no | non-empty | bundled asset | Custom drawing-hand image |
| `hand_mask_path` | string | no | non-empty | bundled asset | Custom drawing-hand mask |

### `SketchOptions`

Every field optional; omitted fields fall back to the domain defaults.

| Field | Type | Range | Default | Notes |
|---|---|---|---|---|
| `frame_rate` | int | 1–120 | `25` | Video fps |
| `split_len` | int | 1–100 | `10` | Grid split length |
| `object_skip_rate` | int | 1–100 | `8` | Skip rate for drawing |
| `draw_duration_sec` | float | 0.1–600 | none | Overrides `object_skip_rate` when set |
| `end_duration_sec` | int | 0–10 | `2` | Final hold on the finished image |
| `black_pixel_threshold` | int | 0–255 | `10` | Black pixel detection threshold |

### Response `200` — `SketchResult`

```json
{ "output_path": "/app/output/photo.mp4" }
```

The video is always named after its source image (`photo.jpg` → `photo.mp4`).

### Example

```bash
curl -X POST http://localhost:8000/api/v1/sketches \
  -H "Content-Type: application/json" \
  -d '{"image_path": "/app/media/photo.jpg", "output_dir": "/app/output", "config": {"split_len": 16}}'
```

---

## `POST /api/v1/sketches/batch`

Generate one video per image found directly (non-recursive) inside a folder.

### Request body — `BatchSketchRequest`

| Field | Type | Required | Constraints | Default | Notes |
|---|---|---|---|---|---|
| `input_dir` | string | yes | non-empty | — | Folder of images |
| `output_dir` | string | no | non-empty | write beside each image | Redirect all videos to one folder |
| `config` | `SketchOptions` | no | see above | all defaults | Same options for every image |
| `object_mask_path` | string | no | non-empty | none | One masks document applied folder-wide |
| `hand_image_path` / `hand_mask_path` | string | no | non-empty | bundled assets | Same semantics as the single request |

### Response `200` — `BatchSketchResult`

```json
{
  "input_dir": "/app/media/photos",
  "items": [
    { "image": "/app/media/photos/a.jpg", "output_path": "/app/output/a.mp4", "error": null },
    { "image": "/app/media/photos/b.jpg", "output_path": null,          "error": "Failed to load image: /app/media/photos/b.jpg" }
  ]
}
```

A failing image is recorded in `items[].error` and does **not** abort the
batch: partial failures still return `200` — only whole-request failures
(missing directory, empty folder) use the error mapping above.

---

## Error mapping

Shared by both POST endpoints and mirrored in the SSE failure events.

| Status | Trigger | Example detail |
|---|---|---|
| `404` | Image / directory / custom hand file does not exist | `Image not found: /app/media/x.png`, `Hand image not found: /app/media/h.png` |
| `422` | Valid JSON, unusable content | unreadable image; folder without supported images (`No supported images found in: ...`); range validation; schema violation |
| `500` | Unexpected failure | message surfaced verbatim for local debugging, also logged server-side |

FastAPI validation errors (schema/range violations) return the default
`422` envelope: `{"detail": [{"loc": ..., "msg": ..., "type": ...}, ...]}`.

---

## `GET /api/v1/events` — Server-Sent Events

oRPC-compatible `text/event-stream` (see `docs/orpc-sse-wire-format.md` for the
full spec) with `Cache-Control: no-cache` and `X-Accel-Buffering: no`.
Lifecycle:

1. **Initial flush** — an anonymous empty comment, sent the moment the client
   attaches so the response headers reach it before the first real event:

   ```
   : \n\n
   ```

   The route subscribes to the bus **before** streaming, so an event published
   between connecting and receiving this frame is never lost.
2. **Message events** — one `data:` frame per event, with a per-connection `id`.
   The SSE `event:` field is deliberately **omitted**: oRPC decodes every
   unnamed frame as the default `message` type (`event: close` / `event: error`
   are the only reserved names). The event name therefore travels inside the
   JSON as the `"event"` discriminant:

   ```
   id: 0
   data: {"event": "sketch.started", "image": "/app/media/a.jpg", "output_path": "/app/output/a.mp4"}
   ```

   The discriminant is authoritative: a payload field named `"event"` never
   overwrites it.
3. **Keep-alives** — after 15 s of silence the bus emits the reserved
   `keepalive` event, rendered as an anonymous comment (`: \n\n`) so proxies and
   the webview never time out the stream. Comments carry no `id` and are ignored
   by the client.
4. **Close** — when the server shuts down the last frame is
   `event: close\ndata: \n\n`, then the stream ends cleanly. There is no
   `retry:` hint: the oRPC client does not reconnect automatically.

### Event catalogue

Every payload carries `"event": "<name>"` plus these fields:

| Event | When | `data` |
|---|---|---|
| `sketch.started` | single request accepted, before rendering | `{"event", "image", "output_path"}` |
| `sketch.completed` | video written | `{"event", "image", "output_path"}` |
| `sketch.failed` | rendering failed | `{"event", "image", "output_path", "error"}` |
| `batch.started` | batch request accepted | `{"event", "input_dir"}` |
| `batch.completed` | batch finished | `{"event", "input_dir", "succeeded", "failed"}` (ints) |
| `batch.failed` | batch failed before/while processing | `{"event", "input_dir", "error"}` |

`image` / `output_path` fields carry the same strings as the corresponding
REST responses (`404`/`422` messages mirror the `error` values).

### Frontend usage

The typed contract lives in the frontend's `rpc/` module. With the raw
`EventSource` API, read the discriminant from the payload — named listeners
never fire, because application frames carry no `event:` field:

```typescript
const source = new EventSource("http://localhost:8000/api/v1/events");

source.onmessage = (message) => {
  const payload: { event: string } & Record<string, unknown> = JSON.parse(message.data);
  switch (payload.event) {
    case "sketch.completed": /* payload.output_path */ break;
    case "sketch.failed":    /* payload.error */       break;
    // batch.started | batch.completed | batch.failed | sketch.started
  }
};

source.addEventListener("close", () => source.close()); // terminal frame
```

Anonymous comments (`: \n\n`) are handled by the browser and never dispatched.

---

## Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| `APP_HOST` | `0.0.0.0` | Bind host |
| `APP_PORT` | `8000` | Bind port (1–65535) |
| `APP_LOG_LEVEL` | `info` | uvicorn log level |
| `APP_CORS_ORIGINS` | `["http://localhost:1420", "http://localhost:3000", "http://127.0.0.1:3000", "http://tauri.localhost", "tauri://localhost"]` | JSON list of allowed CORS origins |

CORS allows credentials and all methods/headers for the listed origins; the
default list covers the Tauri dev server, the `frontend/` Vite dev server
(`bun run dev`, port 3000) and both Tauri webview origins.

---

## Concurrency notes

- Multiple generations can run simultaneously (each in a worker thread), but
  they share CPU; the typical UI disables the submit button while a request
  is in flight.
- Events published while **no** SSE client is attached are not replayed —
  subscribe before triggering long operations.
- Requests against paths that do not exist *inside the container* fail with
  `404`; see `docs/tauri-integration.md` for the volume mapping
  (`./media → /app/media`, `./output → /app/output`).
