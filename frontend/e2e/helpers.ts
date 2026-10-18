import { expect, type Page } from "@playwright/test";

/**
 * Load the app and wait for the startup gate to clear.
 *
 * The gate only opens once `GET /api/v1/health` answers, so everything after
 * this point is talking to a live backend.
 */
export async function openWorkspace(page: Page): Promise<void> {
  await page.goto("/");

  await expect(page.getByTestId("health-badge")).toContainText("ok");
  await expect(page.getByTestId("sse-badge")).toContainText(
    /Connecting|SSE Live/,
  );
}

/** Open the settings dialog, where the raw SSE history is rendered. */
export async function openEventLog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByTestId("event-log")).toBeVisible();
}
