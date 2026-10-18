# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: a solo creator or small studio** making whiteboard-style sketch videos — an image is
animated as if a hand draws it — for social clips, explainers, lesson visuals, and product
demos. They sit at one machine with their own image files, often producing several videos in a
sitting, and they ship the MP4 afterwards. They are comfortable with a technical tool (Docker,
file paths, frame rates) but are not doing this for fun: the render has to come out right and be
out the door.

## Product Purpose

Turn static images into animated sketch videos with a realistic drawing hand, locally. The
desktop app is the primary surface for that: pick an image (or a folder), adjust how the drawing
behaves, run it, preview the result, save the MP4 where they want it. Success means the user
finishes with videos on their disk and no lingering files or cleanup on the backend.

## Positioning

The drawing is *object-aware*: object masks decide what the hand draws first, so the animation
follows the meaning of the picture rather than scanning it row by row, and the hand itself is a
real drawn asset, not a synthetic arrow. Everything runs on the user's machine — the engine is
their own Docker container or a native sidecar process — so source images never leave the
computer, and the API keeps nothing: files are uploaded in, fetched back out, and can be deleted.

## Operating Context

- One desktop window (Tauri) with a locally reachable FastAPI backend; the same UI also runs in a
  plain browser against that backend, which is how the end-to-end suite drives it.
- Two execution modes the user can switch between: `docker` (default, the container binds
  localhost:8000) and `sidecar` (the `img2sketch-api` binary run natively). The app starts the
  backend and reports its health.
- The backend is stateless scratch space: inputs are staged by upload, results are downloaded or
  deleted, and nothing persists across a container restart.
- Long renders (seconds to minutes per image); a batch can run for a while, so the app shows live
  progress and an event log the user can read while waiting.
- Terminology in use: *sketch video*, *drawing hand*, *object mask*, *split length*, *drawing
  speed*, *black pixel threshold*, *final frames*, *single / batch mode*.

## Capabilities and Constraints

**Capabilities**

- Single image → one sketch video, with an advanced config panel (drawing speed, split length,
  frame rate, end duration, black pixel threshold) and optional object-mask / hand-image /
  hand-mask files.
- Batch: a folder of images → one video each, with per-item success/failure, a summary, and a
  per-row download and delete.
- Inputs picked from the user's computer (native dialog in the desktop app, file input in a
  browser) are staged through the API before the run; host paths are never invented.
- Live progress over SSE (percent, current drawing group, frame counter, batch position), an
  accumulated event log, health and stream badges, and toast notifications including verbatim
  server errors.
- Results: inline preview, download to a chosen folder, delete one/by row/all, and remove the
  uploads this session staged.

**Constraints**

- The desktop workspace is being **fully redesigned**: screens, flow and hierarchy may be
  re-decided, but every capability above must survive, and it stays a precise professional tool
  rather than a consumer-playful one.
- Text is English; the UI runs offline against `localhost`.
- The Playwright end-to-end suite drives the real UI against the real backend, so the test ids,
  accessible names and form-field ids it uses (`single-image-path`, `batch-row`,
  `event-log`, `sse-badge`, `Generate Sketch Video`, the `Notifications` landmark, …) are a
  contract, not decoration: they must keep resolving, as must the flows they exercise.
- No `window.alert` / `confirm` / `prompt`; selection must browse the user's own computer.
- Frontend stack is fixed: React 19, TypeScript, Tailwind v4 (CSS-first), Vite, lucide icons,
  `motion`, zustand + TanStack Query, bun as the package manager, relative imports only.

## Brand Commitments

- The product is called **AI-Img2Sketch**.
- Confirmed by the user: it must stay a precise, professional tool. Not consumer-playful — no
  mascots, no celebration effects, no gamified badges.

## Evidence on Hand

- Real sample source images in `images/` (hand-drawn and photo-like line art, object-mask JSON).
- A working reference of the output: the rendered sketch videos themselves, with the drawing-hand
  asset in `src/ai_img2sketch/resources/images/` (`drawing-hand.png`, `hand-mask.png`).
- The complete API contract in `docs/api.md`, and the engine's own CLI.
- Absent, and not to be invented: customers, testimonials, benchmarks, pricing, or performance
  claims. There is no public marketing surface.

## Product Principles

1. **Local and private by default.** Files travel in and out of the user's own machine only; the
   app says where a file is and that it can be removed, and never leaves the user guessing.
2. **Show the work.** A render is the product: progress, the current drawing group, the frame
   count and the finished video are visible while they happen, never hidden behind a bare spinner.
3. **Precision, quietly.** Every parameter that changes the output is reachable and explained in
   the user's own terms; defaults are stated rather than implied, and nothing surprising happens
   because a setting was invisible.
4. **Batch is a first-class mode.** Many images at once is a normal way to work, with per-item
   truth and one action that cleans up what the run produced.
5. **The result is made to ship.** The flow ends at a real file on the user's disk, in the folder
   they chose, in a state they can use.

## Accessibility & Inclusion

Keyboard reachable throughout with visible focus; the UI animates, so it must honour
`prefers-reduced-motion`; text on the dark surface must keep readable contrast.
