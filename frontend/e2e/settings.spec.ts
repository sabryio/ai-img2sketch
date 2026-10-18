import { expect, test } from "@playwright/test";
import { ensureFixtures, SINGLE_IMAGE } from "./fixtures";
import { openWorkspace } from "./helpers";

test.beforeAll(() => {
  ensureFixtures();
});

/**
 * Execution mode is not cosmetic: it decides whether a host path is passed
 * through or rewritten into the container's mounted volume. The mapping preview
 * in the single view is where the user sees that before submitting.
 */
test("switching to Docker mode rewrites the path for the container", async ({
  page,
}) => {
  await openWorkspace(page);

  await page.fill("#single-image-path", SINGLE_IMAGE);
  await expect(page.getByText("Backend Path Mapping (sidecar):")).toBeVisible();
  await expect(page.getByText("sidecar Mode")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByPlaceholder("http://localhost:8000")).toHaveValue(
    "http://localhost:8000",
  );

  await page.locator('input[name="executionMode"][value="docker"]').check();
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByText("docker Mode")).toBeVisible();
  await expect(page.getByText("Backend Path Mapping (docker):")).toBeVisible();
  await expect(page.getByText("/app/media/hand-mask.png")).toBeVisible();

  // And back, so the suite never leaves the app pointed at a container.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator('input[name="executionMode"][value="sidecar"]').check();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("sidecar Mode")).toBeVisible();
});
