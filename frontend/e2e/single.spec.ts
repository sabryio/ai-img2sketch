import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BATCH_DIR, ensureFixtures, SINGLE_IMAGE, toPosix } from "./fixtures";
import { openEventLog, openWorkspace } from "./helpers";

/**
 * The whole single-sketch path, end to end: the form posts to the API, the
 * backend renders a real MP4 on the host, the UI resolves and shows the output
 * path, and the lifecycle events arrive back over SSE.
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

  await page.fill("#single-image-path", SINGLE_IMAGE);
  // The path mapping helper reflects sidecar pass-through before submitting.
  await expect(page.getByText("Backend Path Mapping (sidecar):")).toBeVisible();

  await page.getByRole("button", { name: "Generate Sketch Video" }).click();

  // Result card, carrying the resolved host path of the produced video. With no
  // `output_dir` the backend writes next to the source image.
  const outputPath = page.getByTestId("single-output-path");
  await expect(outputPath).toBeVisible();
  const producedPath = (await outputPath.textContent())!.trim();

  expect(producedPath).toBe(toPosix(join(BATCH_DIR, "hand-mask.mp4")));
  expect(existsSync(producedPath)).toBe(true);

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

test("rejects a path the backend cannot see with a 404 explanation", async ({
  page,
}) => {
  await openWorkspace(page);

  await page.fill("#single-image-path", "C:/nope/does-not-exist.png");
  await page.getByRole("button", { name: "Generate Sketch Video" }).click();

  const error = page.getByTestId("single-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("Request Error 404");
  await expect(error).toContainText("not visible to the backend");
  await expect(error).toContainText("sidecar process");

  // The verbatim server payload is available for debugging.
  await expect(error).toContainText("Image not found");

  // The form is usable again: a failure must not wedge the view.
  await expect(
    page.getByRole("button", { name: "Generate Sketch Video" }),
  ).toBeEnabled();
});
