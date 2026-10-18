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
- **Downloads** — `GET /api/v1/artifacts/download`, the one call whose body *is*
  the result. `src/rpc/artifacts.ts` owns the URL it builds and reports failures
  as the same `ORPCError` the contract raises, so `toAppError` still renders them
  (a component never builds a URL, and no video is base64-encoded into JSON).
- **SSE** — `GET /api/v1/events`, opened by `App.tsx`, which owns both
  subscriptions and passes derived state down:
  - `useLatestEvent()` — a **live query**: `data` is the newest event, plus
    `isLoading` / `error` / `refetch` for the connection itself. This drives the
    header badge, the diagnostic line and reconnects.
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

## Execution modes and paths

| Mode      | Who runs the backend                  | Paths in requests                       |
| --------- | ------------------------------------- | --------------------------------------- |
| `docker`  | container with `./media`, `./output`  | `/app/media/...`, `/app/output/...`     |
| `sidecar` | `img2sketch-api` native host process  | host paths, passed through unchanged    |

`src/lib/paths.ts` holds the mapping; the views preview it under the input so
the user can see what the backend will actually read. A path that is **already**
inside `./media` keeps its subpath and needs no copy; a file from anywhere else
is copied into the mounted media directory before the request, and a failed copy
aborts with a toast instead of turning into a confusing `404`.

The **Output Folder** field sits in the main card, not behind the advanced
section, because its default is the interesting part: leave it empty and every
video is written next to its own image (the backend's own default). Typing a
folder maps it the same way (`./output/runs` → `/app/output/runs`, and
`./media/runs` → `/app/media/runs`), and the line under the field states where
the videos will actually land before anything is submitted.

A folder **outside** the volumes is the one thing the container cannot write to.
`planOutput()` splits that case in two, and the field says which applies:

- **Desktop app** — render beside the image, then copy the finished file into the
  requested folder with `tauri-plugin-fs` (`exportDir`).
- **Browser** — render beside the image and offer the Download button, because a
  page cannot write to a host path on its own.

Both the desktop app and a browser default to `docker`: it is the mode the
service ships in, and it is what the API expects (the container only reads the
two mounts). `sidecar` is one click away in Settings for running the
`img2sketch-api` binary directly.

### Picking files

`Pick Image` / `Select Folder` open the platform's own dialog in both hosts, but
they can only hand over different things:

- **Desktop app** — the native dialog returns a **host path**, which the mapping
  above takes from there.
- **Browser** — a `<input type="file">` returns the **bytes**, and a browser has
  no way to name a host path. They are uploaded to `POST /api/v1/media`, which
  writes them into `<APP_MEDIA_DIR>/uploads` (the mounted volume) and answers
  with the path the backend can read. A folder pick becomes one bucket
  (`uploads/<bucket>/`) so a batch run gets a real `input_dir`; `src/lib/media.ts`
  owns the encoding, the bucket name and the size caps.

Either way the form field ends up holding a path the backend can open — never an
invented one. The same rule applies to the optional mask/hand images in the
advanced section.

### Downloading results

The backend writes inside its volumes, so the video the API reports lives on a
path a browser cannot read. Each result therefore has a **Download** button
(single view and every batch row) that fetches the file from
`GET /api/v1/artifacts/download` and hands it to the user:

- **Desktop app** — the native save dialog asks for a path, and Tauri writes the
  bytes there: the only way to target an arbitrary host folder.
- **Browser** — `showSaveFilePicker` when the browser has it (Chromium, secure
  context), so the folder is still chosen by the user; otherwise a plain download
  through the browser's own download UI. Cancelling either leaves the video
  untouched and shows nothing.

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
  plus pure logic (`errors`, `notifications`, `paths`, `media`, `contract`,
  `artifacts`, `toSseState`).
- `e2e/*.spec.ts` — Playwright against the real stack: the Docker backend
  (`docker compose up -d`, reused when it is already running) and a real
  Chromium. It drives the UI, asserts on the MP4 files written on disk, and
  checks the lifecycle events that arrived over SSE — both the accumulated log
  and the live query's newest event. Inputs are two small images copied out of
  `images/` into `media/e2e/` (and outputs go to `output/e2e/`), because the
  container only sees the compose mounts; both folders are gitignored and the
  suite never touches the rest of `media/` or `output/`. `e2e/upload.spec.ts`
  additionally drives the real file dialog (Playwright's `filechooser`), so the
  browser upload path is covered end to end; it wipes `media/uploads/` first,
  which is where the app stages those picks. `e2e/download.spec.ts` captures a
  real download (via the `stubSavePicker` helper in `e2e/helpers.ts`: the native
  save dialog cannot be driven, so the spec exercises the browser fallback) and
  checks the bytes on disk are an MP4. Run
  `docker compose build` first when the backend changed — an already-running
  container is reused, so a stale image would otherwise be under test.

```bash
bun run test:e2e                 # whole suite
bun run test:e2e e2e/single.spec.ts
bun run test:e2e --headed        # watch it happen
```

Both servers are reused when already running, so an open `bun run dev` session
and a test run can share them.
