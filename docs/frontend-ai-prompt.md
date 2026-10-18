# AI Prompt: Generate the Tauri Frontend

> Copy everything below the line into the AI coding agent working in this
> repository. The backend is complete (see `docs/api.md` for the full reference
> and `docs/tauri-integration.md` for operational guidance) — this prompt asks
> only for the frontend.

---

## Role

You are generating the **frontend for the Tauri app** that drives the
AI-Img2Sketch backend (FastAPI + SSE, running either Dockerized on
`127.0.0.1:8000` or as the `img2sketch-api` sidecar on the same port). The
backend already exists — **do not touch `src/ai_img2sketch/`, the Dockerfile,
or docker-compose**; the webview talks to it only over HTTP/SSE.

## Stack

- **Tauri 2** + **Vite** + **React 18** + **TypeScript (strict)**. Dev server
  must run on `http://localhost:1420` (the backend pre-approves this origin).
- Styling: plain CSS modules or Tailwind — pick one and stay consistent.
- State: a small store (Zustand) or React context — no Redux.
- Tauri plugins you may use: `tauri-plugin-shell` (start the backend /
  compose), `tauri-plugin-fs`, `tauri-plugin-dialog` (image/folder pickers),
  `tauri-plugin-logger`. Avoid anything heavier.

## Files to read first

1. `docs/api.md` — endpoint contracts, schemas, SSE protocol, error mapping.
2. `docs/tauri-integration.md` — startup strategies, lifecycle, path handling.
3. `ARCHITECTURE.md` — only to understand *why* the backend behaves as it does.

## Architecture rules for the generated code

Mirror the backend's layering — dependencies point inward:

```
src/
  lib/api/
    client.ts        # typed fetch wrappers for every endpoint (no UI imports)
    sse.ts           # EventSource module: named listeners, reconnect, close()
    types.ts         # request/response DTOs mirroring docs/api.md exactly
  stores/
    backend.ts       # health status, backend availability
    generation.ts    # requests in flight, results, batch tables, last error
  components/        # pure presentational pieces
  App.tsx            # layout + wiring
```

- **No business logic inside components**: components call stores/functions
  from `lib/api` and render state.
- All HTTP/SSE code in `lib/api` — components never import `EventSource`.
- URLs come from a single `API_BASE` constant (default
  `http://localhost:8000`, overridable via `TAURI_ENV` / `.env`), never
  hardcoded inline.

## Features to implement

### 1. Backend health & lifecycle (startup gate)
- On app mount: poll `GET /api/v1/health` every 2 s until `{"status": "ok"}`,
  then render the main UI.
- While down: show a "starting backend" screen with the retry state and a
  manual "Retry now" button.
- Provide app-level actions to start/stop the backend:
  - `docker compose up -d / down` via `tauri-plugin-shell` when Docker is
    available (`docker info` probe first — exit code 0 means running).
  - Sidecar path: spawn `img2sketch-api` as a Tauri sidecar
    (`externalBin` configured in `tauri.conf.json`) for the no-Docker case.
- **Docker-not-running UX**: a clear, non-blocking panel — "Backend isn't
  reachable. Start Docker Desktop, or run without Docker (sidecar)." Buttons:
  *Start Docker backend* / *Run sidecar* / detailed error message. Never
  silently crash.
- Gate every generation call behind `backend.ready` (health OK).

### 2. SSE event stream (one per app session)
- `lib/api/sse.ts`: connect once at app start (after first health success),
  `new EventSource(API_BASE + "/api/v1/events")`.
- Register named listeners for `sketch.started`, `sketch.completed`,
  `sketch.failed`, `batch.started`, `batch.completed`, `batch.failed`; parse
  `event.data` JSON and feed `stores/generation.ts`. Anonymous comments
  (`: connected`, `: keep-alive`) need no handling.
- Track connection state (`online` / `reconnecting` / `closed`) in store and
  render a small connection badge. The browser auto-reconnects using the
  server's `retry: 5000` — no manual reconnect logic.
- `source.close()` on window `beforeunload`.
- Expectation (documented): events are **lifecycle-level** (started /
  completed / failed); per-frame progress does not exist yet. A spinner with
  elapsed time is the correct progress UI. REST responses remain the source
  of truth for navigation; events are ambient updates.

### 3. Single generation screen (`POST /api/v1/sketches`)
- Image picker (Tauri dialog) for `image_path`.
- Collapsible "Advanced options" panel with the full `config` object and
  range enforcement mirroring `docs/api.md`:
  - `frame_rate` 1–120 (default 25), `split_len` 1–100 (default 10),
    `object_skip_rate` 1–100 (default 8),
    `draw_duration_sec` 0.1–600 (optional number input),
    `end_duration_sec` 0–10 (default 2),
    `black_pixel_threshold` 0–255 (default 10, in a "rarely touched" group).
  - Optional file pickers: `object_mask_path`, `hand_image_path`,
    `hand_mask_path`.
  - `output_dir` visible but optional.
- Submit → POST; disable the button and show the spinner state until the
  response resolves (request is synchronous; may run seconds to minutes), plus a
  **live progress bar** driven by the `sketch.progress` frames on the event
  stream: raw `percent` over the whole run, the group `label`, and
  `frame` / `total_frames`. Reset it when a run starts so a finished run's 100%
  can never flash on the next one.
- On success: show `output_path`, an embedded preview — the file lives inside
  the backend, so stream it with
  `GET /api/v1/artifacts/download?path=...&disposition=inline` rather than trying
  to read the path — a **Download** button (saved through the native dialog in
  Tauri and the browser's own save UI elsewhere), and a **Delete** button
  (`DELETE /api/v1/artifacts?path=...`) so keeping the file or dropping it is the
  user's decision. Disable both once it has been deleted.
- **Path mapping must be explicit** in a `lib/paths.ts` module:
  - sidecar mode → request paths are plain local paths as-is;
  - Docker mode → the backend has no host mounts: it only reads files that were
    uploaded and only writes inside its own directories. A host path is
    therefore something to *read and upload* (`POST /api/v1/media`, with
    `tauri-plugin-fs` supplying the bytes in the desktop app), and the path the
    API answers with is what the request carries. A typed host output folder
    cannot be written by the container: render beside the image, then hand the
    fetched video to that folder (the desktop app writes it; a browser
    downloads it). Surface the active mode in the UI so the user understands
    where files have to live.
- Offer to remove what this session uploaded (`DELETE /api/v1/artifacts` on the
  staged paths), so a private source image does not have to be left behind.

### 4. Batch screen (`POST /api/v1/sketches/batch`)
- Folder picker for `input_dir`, same options panel, same path-mapping rules,
  same live progress bar with the added position: `item_index` / `item_total` /
  `item_name` from `batch.progress` ("image 2 of 5 · b.png").
- Result: a table of `items` (`image`, `output_path`, `error`), highlighting
  failed rows but not aborting; summary line from the `batch.completed` event
  payload (`succeeded` / `failed` counts).
- Allow previewing, downloading and deleting each produced video from its row,
  and offer one action that deletes every video the run left on the backend.

### 5. Errors
- Map every failure the way the backend does (see `docs/api.md`):
  - `404` → "file/folder not visible to the backend" (mention the active
    mode — Docker vs sidecar — because that is the usual culprit),
  - `422` → show the first `detail` message,
  - `500` → show the verbatim message with a copy button (it is meant for
    local debugging).
- `sketch.failed` / `batch.failed` SSE events → toast/banner with the `error`
  payload; deduplicate against already-shown request errors.
- No alert() dialogs; banners or toasts.

### 6. Non-functional requirements
- React 18 function components only; no any; `strict` TS passes
  `tsc --noEmit`.
- Unit tests (vitest): SSE module (mock EventSource emits named events →
  store transitions) and the type mapping test posting a fixture payload.
- Everything user-visible in English; keep copy short and grounded in the
  error mapping, not invented.
- Accessibility: labels on all controls, focus states, keyboard-operable.

## Acceptance criteria

1. With the backend down, the app shows the starting screen; with Docker
   started it recovers automatically or via "Retry now".
2. Generating a video end-to-end against the real backend (Docker compose up)
   shows preview; output path maps correctly back to the host in Docker mode.
3. Batch of ≥3 images (one intentionally corrupt) renders a table with 2
   successes and 1 recorded failure, app functional afterwards.
4. SSE events feed the connection badge and toasts; killing the container
   mid-session closes the stream with the `close` event, not an error toast.
5. `tsc --noEmit`, build, and unit tests pass; no UI file contains fetch or
   EventSource outside `lib/api`.
