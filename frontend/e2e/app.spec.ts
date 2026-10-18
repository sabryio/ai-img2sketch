import { expect, test } from "@playwright/test";
import { ensureFixtures } from "./fixtures";
import { openEventLog, openWorkspace } from "./helpers";

/**
 * The app can only be useful if it finds the backend on its own: the startup
 * gate must clear, the header must agree, and the event stream must be open and
 * idle before anything is generated.
 */
test.beforeAll(() => {
  ensureFixtures();
});

test("clears the startup gate and opens the event stream", async ({ page }) => {
  await openWorkspace(page);

  // A browser talks to a process on the same host: pass-through paths are the
  // correct default there (the desktop app defaults to Docker instead).
  await expect(page.getByText("sidecar Mode")).toBeVisible();

  // The stream is up but has not seen an event yet: oRPC filters the backend's
  // keep-alive comments, so "connecting" is the honest state here.
  await expect(page.getByTestId("sse-badge")).toContainText("Connecting");

  await openEventLog(page);
  await expect(page.getByTestId("event-log")).toContainText(
    "No events received yet",
  );
  await expect(page.getByTestId("sse-state")).toContainText("0 events");
  await expect(page.getByTestId("sse-state")).toContainText("last: —");
});
