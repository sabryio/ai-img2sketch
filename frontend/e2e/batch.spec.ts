import { statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  artifactUrl,
  createFixtures,
  DOWNLOAD_DIR,
  type Fixtures,
  NO_IMAGES_DIR,
} from "./fixtures";
import { openEventLog, openWorkspace, stubSavePicker } from "./helpers";

/**
 * Batch processing, end to end, in the default Docker mode.
 *
 * The images were uploaded by the fixture, so the container owns them; with no
 * output folder the videos land beside their sources. The spec reads the files
 * back through the API — a container path cannot be opened by the test process,
 * so asking the server for them is the only honest check that they exist.
 */
let fixtures: Fixtures;

test.beforeAll(async ({ request }) => {
  fixtures = await createFixtures(request);
});

// The save dialog is native and cannot be driven; the fallback download can.
test.beforeEach(async ({ page }) => {
  await stubSavePicker(page);
});

test("processes a folder beside the source images", async ({ page, request }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Batch Processing" }).click();

  await page.fill("#batch-input-dir", fixtures.batchDir);

  // A host folder cannot be written by a container, and the app says so before
  // anything is sent: the videos are rendered beside the images instead.
  await page.fill("#batch-output-dir", "D:/renders");
  await expect(page.getByTestId("output-plan")).toContainText(
    "cannot write to D:/renders",
  );
  await page.fill("#batch-output-dir", "");

  await page.getByRole("button", { name: "Run Batch Generation" }).click();

  // The bar is live for the whole run, and it says which image is in flight.
  await expect(page.getByTestId("batch-progress")).toBeVisible();
  await expect(page.getByTestId("batch-progress-percent")).toContainText("%");
  await expect(page.getByTestId("batch-progress")).toContainText(
    /image [12] of 2/,
  );

  const rows = page.getByTestId("batch-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Success");
  await expect(rows.nth(1)).toContainText("Success");

  // Images are scanned in name order, so the rows and their videos are fixed.
  await expect(rows.first()).toContainText(fixtures.batchVideo);
  await expect(rows.nth(1)).toContainText(fixtures.singleVideo);

  // The summary is derived from the rows, so the two can never disagree.
  await expect(page.getByTestId("batch-summary")).toContainText("2 Succeeded");
  await expect(page.getByTestId("batch-summary")).toContainText("Total: 2");

  // Both videos really exist where the table says they do.
  for (const path of [fixtures.batchVideo, fixtures.singleVideo]) {
    const served = await request.get(artifactUrl(path));
    expect(served.ok()).toBe(true);
  }

  // One of them can be fetched to the machine.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    rows.first().getByTestId("batch-download").click(),
  ]);
  expect(download.suggestedFilename()).toBe(
    fixtures.batchVideo.split("/").pop(),
  );

  const savedAs = join(DOWNLOAD_DIR, "downloaded-batch-item.mp4");
  await download.saveAs(savedAs);
  expect(statSync(savedAs).size).toBeGreaterThan(0);

  await expect(page.getByTestId("sse-badge")).toContainText("SSE Live");
  await openEventLog(page);
  await expect(page.getByTestId("event-log")).toContainText("batch.started");
  await expect(page.getByTestId("event-log")).toContainText("batch.progress");
  await expect(page.getByTestId("event-log")).toContainText("batch.completed");
  await expect(page.getByTestId("sse-state")).toContainText(
    "last: batch.completed",
  );
});

test("deletes every produced video on request", async ({ page, request }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Batch Processing" }).click();

  await page.fill("#batch-input-dir", fixtures.batchDir);
  await page.getByRole("button", { name: "Run Batch Generation" }).click();

  const rows = page.getByTestId("batch-row");
  await expect(rows).toHaveCount(2);

  await page.getByTestId("batch-delete-all").click();

  // The rows stay (they are the record of the run) but nothing is left behind.
  await expect(rows.first()).toContainText("Deleted");
  await expect(rows.nth(1)).toContainText("Deleted");
  await expect(page.getByTestId("batch-delete-all")).toBeDisabled();
  await expect
    .poll(async () => (await request.get(artifactUrl(fixtures.batchVideo))).status())
    .toBe(404);
  await expect
    .poll(
      async () => (await request.get(artifactUrl(fixtures.singleVideo))).status(),
    )
    .toBe(404);
});

test("reports a folder without supported images as a 422", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Batch Processing" }).click();

  await page.fill("#batch-input-dir", NO_IMAGES_DIR);
  await page.getByRole("button", { name: "Run Batch Generation" }).click();

  const error = page.getByTestId("batch-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("No supported images found in");
  // The server names the directory it scanned, inside the container.
  await expect(error).toContainText(NO_IMAGES_DIR);

  // No partial results are presented as success.
  await expect(page.getByTestId("batch-row")).toHaveCount(0);
});
