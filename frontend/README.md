# AI-Img2Sketch — frontend

React + Vite webview for the `ai-img2sketch` FastAPI service. It is the Tauri
desktop UI, and it also runs in a plain browser against a locally started
backend (that is what the end-to-end suite drives).

## Commands

```bash
bun install
bun run dev        # Vite dev server on http://localhost:3000
bun run build      # production bundle in dist/
bun run lint       # tsc --noEmit
bun run test       # vitest run (unit)
bun run test:e2e   # playwright test (real browser + real backend)
```

The app expects the Docker backend, so start the stack first — `bun run
test:e2e` starts it too if nothing is listening:

```bash
# from the repository root
docker compose up -d      # build first: docker compose build
```

For the native path, run `uv run uvicorn ai_img2sketch.presentation.api.app:app
--host 127.0.0.1 --port 8000` and switch Settings → execution mode to `sidecar`.

## How it talks to the backend

There is exactly one transport, and no component builds a URL or a cache key by
hand.

```
src/rpc/contract.ts   every procedure + schema (single source of truth)
src/rpc/index.ts      OpenAPILink client + TanStack Query utils (`orpc`)
src/hooks/*           one hook per procedure, wrapping `orpc.*`
src/components/*      render only; they never call `fetch`
```

- **REST** — `POST /api/v1/sketches`, `POST /api/v1/sketches/batch`,
  `POST /api/v1/media`, `GET /api/v1/health`. Request/response DTOs are inferred
  from the contract, so a backend schema change that is not mirrored here fails
  `tsc`.
- **Artifacts** — `src/rpc/artifacts.ts` owns the two calls whose body is not
  JSON: `GET /api/v1/artifacts/download` (the body *is* the file — `disposition`
  picks an opaque `attachment` for saving or a typed `inline` for previewing) and
  `DELETE /api/v1/artifacts` (drop a staged upload or a produced file). It reports
  failures as the same `ORPCError` the contract raises, so `toAppError` still
  renders them (a component never builds a URL, and no video is base64-encoded
  into JSON).
- **SSE** — `GET /api/v1/events`, opened by `App.tsx`, which owns both
  subscriptions and passes derived state down:
  - `useLatestEvent()` — a **live query**: `data` is the newest event, plus
    `isLoading` / `error` / `refetch` for the connection itself. This drives the
    header badge, the diagnostic line, the progress bar and reconnects.
  - `useEventStream()` — the same stream **accumulated**: `data` is every event
    of the session, because a live query keeps only the newest value. Measured
    against the real backend, two frames arriving in one read
    (`sketch.started` + `sketch.completed`) leave the live query holding just the
    last one, while the accumulator keeps both. The notification log and the
    failure toasts therefore read the accumulator (`useEventNotifications`);
    anything that only cares about "what just happened" reads the live query.
    Both are mounted once the backend answers, so a cold start does not spray
    reconnect attempts, and either one reconnecting on drop.
- **Errors** — FastAPI answers with `{"detail": ...}`, which oRPC cannot decode
  on its own, so `rpc/index.ts` registers a response-body decoder that turns the
  envelope into a typed `ORPCError`. `toAppError` (`src/lib/errors.ts`) maps it
  for the UI: `404` becomes a path-visibility explanation (with mode-specific
  advice), `422` shows the server detail verbatim, `≥500` is reported as a
  backend processing error.

State lives where it belongs: **server state in TanStack Query**, UI/process
state in Zustand (`stores/backend.ts` for mode and lifecycle commands,
`stores/notifications.ts` for toasts and the event log). Nothing polls the
server from a store.

### Progress

A run reports itself on the same stream it announces itself on. `sketch.progress`
and `batch.progress` frames carry the raw `percent` (over the whole run), the
group `label` being drawn, a `frame` / `total_frames` counter and — for a batch —
the `item_index` / `item_total` / `item_name` of the image in flight.
`useRunProgress` (`src/hooks/`) folds them into the bar's state, and it only
listens while a run is in flight, so a finished run's `100%` can never flash onto
the next one; `src/lib/progress.ts` holds the pure parts (monotonic clamp,
label formatting, batch position) and `ProgressBar.tsx` draws an indeterminate
bar until the first frame arrives.

## Execution modes and paths

| Mode      | Who runs the backend                  | Paths in requests                        |
| --------- | ------------------------------------- | ---------------------------------------- |
| `docker`  | container, no host mounts             | `/app/media/...`, `/app/output/...` only |
| `sidecar` | `img2sketch-api` native host process  | host paths, passed through unchanged     |

The container mounts nothing, so it can only read what it was given and only
write inside its own two directories. `src/lib/paths.ts` holds the rules the
views preview under the input, so the user can see what will actually happen
before submitting:

- a path already inside `/app/media` or `/app/output` is passed through
  unchanged — it is already something the backend owns;
- **any other path is staged**: the file is read where the user picked it (the
  desktop app reads the host path with `tauri-plugin-fs`, a browser has the
  bytes) and uploaded to `POST /api/v1/media`, and the returned path is what the
  request carries. A failed upload aborts with a toast instead of turning into a
  confusing `404`.

The **Output Folder** field sits in the main card, not behind the advanced
section, because its default is the interesting part: leave it empty and every
video is written next to its own image (the backend's own default), which is
also the only place the container can write without being asked for a specific
folder.

A folder the backend does not own is one the container cannot write to.
`planOutput()` splits that case in two, and the field says which applies:

- **Desktop app** — render beside the image, then write the finished file into
  the requested folder with `tauri-plugin-fs` (`exportDir`).
- **Browser** — render beside the image and offer the Download button, because a
  page cannot write to a host path on its own.

Both the desktop app and a browser default to `docker`: it is the mode the
service ships in, and it is what the API expects. `sidecar` is one click away in
Settings for running the `img2sketch-api` binary directly.

### Picking files

`Pick Image` / `Select Folder` open the platform's own dialog in both hosts, but
they can only hand over different things:

- **Desktop app** — the native dialog returns a **host path**; the app reads the
  bytes with `tauri-plugin-fs` and uploads them (`readHostImageFile` /
  `readHostImageDirectory` in `src/lib/tauri.ts`).
- **Browser** — a `<input type="file">` returns the **bytes**, and a browser has
  no way to name a host path. They go straight to `POST /api/v1/media`, which
  writes them into `<APP_MEDIA_DIR>/uploads` and answers with the path the
  backend can read. A folder pick becomes one bucket (`uploads/<bucket>/`) so a
  batch run gets a real `input_dir`; `src/lib/media.ts` owns the encoding, the
  bucket name and the size caps.

Either way the form field ends up holding a path the backend can open — never an
invented one. The same rule applies to the optional mask/hand images in the
advanced section.

### Downloading and deleting results

Every produced video lives inside the backend, so no host path can reach it. Each
result therefore has a **Download** button (single view and every batch row) that
fetches the file from `GET /api/v1/artifacts/download` and hands it to the user:

- **Desktop app** — the native save dialog asks for a path, and Tauri writes the
  bytes there: the only way to target an arbitrary host folder.
- **Browser** — `showSaveFilePicker` when the browser has it (Chromium, secure
  context), so the folder is still chosen by the user; otherwise a plain download
  through the browser's own download UI. Cancelling either leaves the video
  untouched and shows nothing.

The inline preview of a finished video is the same endpoint with
`disposition=inline`, because the path points inside the container and a browser
cannot read it directly.

Files stay until the client says otherwise. **Delete** drops one produced video
(`DELETE /api/v1/artifacts?path=...` on a result or a batch row), a batch view can
drop every video a run created at once, and both views offer to remove the
uploads this session staged — so a private source image does not have to be left
behind. The container's directories are `tmpfs`, so anything left over is gone
with the next restart anyway.

## Runtime configuration

- **API origin** — `src/lib/apiOrigin.ts`: `VITE_API_ORIGIN` at build time,
  then persisted in `localStorage`. Editable in Settings, applied on the next
  request (the link's `origin` is read per request), with the whole query cache
  cleared so nothing stale survives the switch.
- **Tauri plugins** — `src/lib/tauri.ts`. File dialogs, `docker compose`,
  the sidecar binary and the asset protocol need the desktop shell; in a browser
  they degrade explicitly (the pickers return the picked `File` for the caller to
  stage, lifecycle commands report that they require the desktop app) rather than
  pretending to have succeeded.

## Testing

- `src/**/*.test.ts` — Vitest, no DOM: type-level locks on the hooks (a wrapper
  that collapses oRPC generics to `unknown` compiles, so `tsc` is the assertion),
  plus pure logic (`errors`, `notifications`, `paths`, `progress`, `media`,
  `contract`, `artifacts`, `toSseState`).
- `e2e/*.spec.ts` — Playwright against the real stack: the Docker backend
  (`docker compose up -d`, reused when it is already running) and a real
  Chromium. It drives the UI and checks the lifecycle events that arrived over
  SSE — both the accumulated log and the live query's newest event — as well as
  the progress frames. Inputs are the small images in `images/`, uploaded through
  `POST /api/v1/media` by `e2e/fixtures.ts` into a **bucket of its own per run**
  (`uploads/e2e-…`), so a spec always works with exactly the files it uploaded and
  never with what an earlier run left behind; results are checked back through
  `GET /api/v1/artifacts/download`, the way a client would. The container's
  scratch space is `tmpfs`, so a restart clears every bucket.
  `e2e/upload.spec.ts` additionally drives the real file dialog (Playwright's
  `filechooser`), so the browser upload path is covered end to end.
  `e2e/download.spec.ts` captures a real download (via the `stubSavePicker` helper
  in `e2e/helpers.ts`: the native save dialog cannot be driven, so the spec
  exercises the browser fallback) and checks the bytes are an MP4. Run
  `docker compose build` first when the backend changed — an already-running
  container is reused, so a stale image would otherwise be under test.

```bash
bun run test:e2e                 # whole suite
bun run test:e2e e2e/single.spec.ts
bun run test:e2e --headed        # watch it happen
```

Both servers are reused when already running, so an open `bun run dev` session
and a test run can share them.
