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

Start the backend first (`bun run test:e2e` starts its own if none is running):

```bash
# from the repository root
uv run uvicorn ai_img2sketch.presentation.api.app:app --host 127.0.0.1 --port 8000
# or, packaged:
docker compose up -d
```

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
  `GET /api/v1/health`. Request/response DTOs are inferred from the contract, so
  a backend schema change that is not mirrored here fails `tsc`.
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
the user can see what the backend will actually read. In Docker mode a picked
host file is copied into the mounted media directory before the request, and a
failed copy aborts with a toast instead of turning into a confusing `404`.

The desktop app defaults to `docker`; a browser defaults to `sidecar`, because a
browser always talks to a process on the same host.

## Runtime configuration

- **API origin** — `src/lib/apiOrigin.ts`: `VITE_API_ORIGIN` at build time,
  then persisted in `localStorage`. Editable in Settings, applied on the next
  request (the link's `origin` is read per request), with the whole query cache
  cleared so nothing stale survives the switch.
- **Tauri plugins** — `src/lib/tauri.ts`. File dialogs, `docker compose`,
  the sidecar binary and the asset protocol need the desktop shell; in a browser
  they degrade explicitly (dialogs ask for a path, lifecycle commands report that
  they require the desktop app) rather than pretending to have succeeded.

## Testing

- `src/**/*.test.ts` — Vitest, no DOM: type-level locks on the hooks (a wrapper
  that collapses oRPC generics to `unknown` compiles, so `tsc` is the assertion),
  plus pure logic (`errors`, `notifications`, `paths`, `contract`, `toSseState`).
- `e2e/*.spec.ts` — Playwright against a real backend and a real Chromium. It
  drives the UI, asserts on the MP4 files written on disk, and checks the
  lifecycle events that arrived over SSE — both the accumulated log and the live
  query's newest event. Inputs are two small images copied out of `images/` into
  a temp workspace (`e2e/fixtures.ts`), so no binaries are committed and renders
  stay under a second.

```bash
bun run test:e2e                 # whole suite
bun run test:e2e e2e/single.spec.ts
bun run test:e2e --headed        # watch it happen
```

Both servers are reused when already running, so an open `bun run dev` session
and a test run can share them.
