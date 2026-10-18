import { expect, test } from "@playwright/test";
import { openWorkspace } from "./helpers";

/**
 * Execution mode is not cosmetic: it decides whether a typed path can be handed
 * to the backend as-is or has to be uploaded first. The mapping preview in the
 * single view is where the user sees that before submitting.
 */
test("mode decides whether a typed path is uploaded or read as-is", async ({
  page,
}) => {
  await openWorkspace(page);

  // Docker is the default, and it has no host mounts: a host path is uploaded
  // when the run starts.
  await expect(page.getByText("docker Mode")).toBeVisible();
  await page.fill("#single-image-path", "D:/photos/cat.png");
  await expect(page.getByText("Backend Path (docker):")).toBeVisible();
  await expect(
    page.getByText(/uploaded to the backend when the run starts/),
  ).toBeVisible();

  // A path the API itself handed back is already readable: nothing to upload.
  await page.fill("#single-image-path", "/app/media/uploads/e2e/cat.png");
  await expect(
    page.getByText(/uploaded to the backend when the run starts/),
  ).toHaveCount(0);

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
  await page.fill("#single-image-path", "D:/photos/cat.png");
  await expect(page.getByText("Backend Path (sidecar):")).toBeVisible();
  await expect(
    page.getByText(/uploaded to the backend when the run starts/),
  ).toHaveCount(0);

  // Back to the default, so the visible state matches a fresh app.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator('input[name="executionMode"][value="docker"]').check();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("docker Mode")).toBeVisible();
});
