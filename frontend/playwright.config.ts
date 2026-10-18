import { defineConfig } from "@playwright/test";

/**
 * End-to-end suite for the desktop app, run against the real stack:
 *
 * - the Docker backend (`docker compose up -d`, health on 127.0.0.1:8000)
 * - the Vite dev server (`bun run dev`, port 3000)
 *
 * Nothing is mocked: the specs drive the UI, the UI uploads the inputs to the
 * container and downloads the results, the API renders real MP4s, and the specs
 * fetch those files back through the API. That is also the mode the app starts
 * in, so the suite exercises what a user actually gets.
 *
 * The container has no host mounts, so the fixtures are uploaded through
 * `POST /api/v1/media` and the specs only ever hold container paths — see
 * `e2e/fixtures.ts`.
 *
 * Both servers are reused when already running, so a long-lived Docker stack is
 * left exactly as it is. Rebuild it first (`docker compose build`) after a
 * backend change, or the specs would be testing a stale image.
 */
export default defineConfig({
  testDir: "./e2e",
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
      command: "docker compose up -d",
      cwd: "..",
      url: "http://127.0.0.1:8000/api/v1/health",
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "bun run dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
