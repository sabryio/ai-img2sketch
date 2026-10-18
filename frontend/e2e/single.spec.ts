import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  containerPath,
  ensureFixtures,
  hostPathOf,
  MISSING_IMAGE,
  SINGLE_IMAGE,
  uiPath,
} from "./fixtures";
import { openEventLog, openWorkspace } from "./helpers";

/**
 * The whole single-sketch path, end to end, in the default Docker mode: the UI
 * maps the typed host path into the container's mounted volume, the container
 * renders a real MP4 into the host's `./media`, the UI maps the answer back to a
 * host path, and the lifecycle events arrive over SSE.
 *
 * The spec asserts on the file on disk, not just on the DOM, so a UI that lied
 * about the result could not pass.
 */
test.beforeAll(() => {
  ensureFixtures();
});

test("generates a sketch video and reports it on the event stream", async ({
  page,
}) => {
  await openWorkspace(page);

  const sourcePath = uiPath(SINGLE_IMAGE);
  await page.fill("#single-image-path", sourcePath);

  // The preview shows the mapping before anything is sent: a path already
  // inside `./media` is readable by the container, so no copy is proposed.
  await expect(page.getByText("Backend Path Mapping (docker):")).toBeVisible();
  await expect(page.getByText(containerPath(SINGLE_IMAGE))).toBeVisible();
  await expect(page.getByText(/is copied into the Docker volume/)).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Generate Sketch Video" }).click();

  // Result card, carrying the resolved host path of the produced video. With no
  // `output_dir` the backend writes next to the source image, which for a file
  // in `./media` means the video appears on the host in the same folder.
  const outputPath = page.getByTestId("single-output-path");
  await expect(outputPath).toBeVisible();
  const producedPath = (await outputPath.textContent())!.trim();

  expect(producedPath).toBe("./media/e2e/batch/hand-mask.mp4");
  expect(existsSync(hostPathOf(producedPath))).toBe(true);

  // Success is announced once, through the mutation result (the result card
  // carries a longer version of the same words, so scope to the toast stack).
  await expect(
    page
      .getByRole("complementary", { name: "Notifications" })
      .getByText("Sketch Video Generated"),
  ).toBeVisible();

  // The live query saw the newest event, and the accumulator saw both.
  await expect(page.getByTestId("sse-badge")).toContainText("SSE Live");
  await openEventLog(page);
  const log = page.getByTestId("event-log");
  await expect(log).toContainText("sketch.started");
  await expect(log).toContainText("sketch.completed");
  await expect(log).toContainText("hand-mask.png");
  await expect(page.getByTestId("sse-state")).toContainText(
    "last: sketch.completed",
  );
});

test("rejects a path the container cannot see with a 404 explanation", async ({
  page,
}) => {
  await openWorkspace(page);

  await page.fill("#single-image-path", uiPath(MISSING_IMAGE));
  await page.getByRole("button", { name: "Generate Sketch Video" }).click();

  const error = page.getByTestId("single-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("Request Error 404");
  await expect(error).toContainText("mounted media directory");
  await expect(error).toContainText(containerPath(MISSING_IMAGE));

  // The form is usable again: a failure must not wedge the view.
  await expect(
    page.getByRole("button", { name: "Generate Sketch Video" }),
  ).toBeEnabled();
});
