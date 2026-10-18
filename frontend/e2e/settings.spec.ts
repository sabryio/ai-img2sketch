import { expect, test } from "@playwright/test";
import { containerPath, ensureFixtures, SINGLE_IMAGE, uiPath } from "./fixtures";
import { openWorkspace } from "./helpers";

test.beforeAll(() => {
  ensureFixtures();
});

/**
 * Execution mode is not cosmetic: it decides whether a host path is passed
 * through or rewritten into the container's mounted volume. The mapping preview
 * in the single view is where the user sees that before submitting.
 */
test("execution mode decides whether the path is rewritten or passed through", async ({
  page,
}) => {
  await openWorkspace(page);

  // Docker is the default, and the preview says what the container will read.
  await expect(page.getByText("docker Mode")).toBeVisible();
  await page.fill("#single-image-path", uiPath(SINGLE_IMAGE));
  await expect(page.getByText("Backend Path Mapping (docker):")).toBeVisible();
  await expect(page.getByText(containerPath(SINGLE_IMAGE))).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByPlaceholder("http://localhost:8000")).toHaveValue(
    "http://localhost:8000",
  );
  await expect(
    page.locator('input[name="executionMode"][value="docker"]'),
  ).toBeChecked();

  // Sidecar mode talks to a process on the host: the path is passed through.
  await page.locator('input[name="executionMode"][value="sidecar"]').check();
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByText("sidecar Mode")).toBeVisible();
  await expect(page.getByText("Backend Path Mapping (sidecar):")).toBeVisible();
  await expect(
    page.getByText(uiPath(SINGLE_IMAGE), { exact: false }).first(),
  ).toBeVisible();

  // Back to the default, so the visible state matches a fresh app.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator('input[name="executionMode"][value="docker"]').check();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("docker Mode")).toBeVisible();
});
