import { defineConfig } from "@playwright/test";

/**
 * End-to-end suite for the desktop app, run against the real stack:
 *
 * - the Vite dev server (`bun run dev`, port 3000)
 * - the FastAPI service on 127.0.0.1:8000, started from the repo root
 *
 * Nothing is mocked: the specs drive the UI, the UI calls the API over HTTP and
 * consumes the SSE stream, and the specs verify the produced files on disk.
 * Inputs are tiny images (`e2e/fixtures.ts`), so a full render takes well under
 * a second and the suite stays quick.
 *
 * Both servers are reused when already running, so a dev session and a test run
 * can share them.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One render at a time: the backend is CPU-bound and the specs share a
  // workspace directory.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    // The full Chromium build (`playwright install chromium`), not the separate
    // headless-shell download, so one browser artefact is all a fresh checkout
    // needs.
    channel: "chromium",
    baseURL: "http://localhost:3000",
    // Wide enough for the `lg` breakpoint, where the mode switcher lives.
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "uv run uvicorn ai_img2sketch.presentation.api.app:app --host 127.0.0.1 --port 8000",
      cwd: "..",
      url: "http://127.0.0.1:8000/api/v1/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "bun run dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
