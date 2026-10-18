import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  BATCH_DIR,
  containerPath,
  EMPTY_DIR,
  ensureFixtures,
  OUTPUT_DIR,
  OUTPUT_ROOT,
  toPosix,
  uiPath,
} from "./fixtures";
import { openEventLog, openWorkspace, stubSavePicker } from "./helpers";

test.beforeAll(() => {
  ensureFixtures();
});

// The save dialog is native and cannot be driven; the fallback download can.
test.beforeEach(async ({ page }) => {
  await stubSavePicker(page);
});

test("processes a folder into the requested output directory", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Batch Processing" }).click();

  await page.fill("#batch-input-dir", uiPath(BATCH_DIR));
  // `output_dir` is optional and sits in the main card. A relative `./output/...`
  // is inside the compose mount, so the app rewrites it to `/app/output/...` for
  // the container; asking for it here proves that path reaches the request.
  await page.fill("#batch-output-dir", uiPath(OUTPUT_DIR));
  await expect(page.getByTestId("output-plan")).toContainText(
    "/app/output/e2e",
  );

  await page.getByRole("button", { name: "Run Batch Generation" }).click();

  const rows = page.getByTestId("batch-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Success");
  await expect(rows.nth(1)).toContainText("Success");
  // Every row is a real file, written where the form asked for it — mapped back
  // from `/app/output/...` to the host `./output/e2e`.
  await expect(rows.first()).toContainText("./output/e2e");
  await expect(rows.first()).toContainText(".mp4");

  // The summary is derived from the rows, so the two can never disagree.
  await expect(page.getByTestId("batch-summary")).toContainText("2 Succeeded");
  await expect(page.getByTestId("batch-summary")).toContainText("Total: 2");

  const produced = readdirSync(OUTPUT_DIR).filter((name) =>
    name.endsWith(".mp4"),
  );
  expect(produced).toHaveLength(2);

  // One produced video can be fetched back — this time from the output volume,
  // which is a different root than the media volume the other specs download
  // from.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    rows.first().getByTestId("batch-download").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.mp4$/);

  const savedAs = join(OUTPUT_ROOT, "downloaded-batch-item.mp4");
  await download.saveAs(savedAs);
  expect(statSync(savedAs).size).toBeGreaterThan(0);

  await expect(page.getByTestId("sse-badge")).toContainText("SSE Live");
  await openEventLog(page);
  await expect(page.getByTestId("event-log")).toContainText("batch.started");
  await expect(page.getByTestId("event-log")).toContainText("batch.completed");
  await expect(page.getByTestId("sse-state")).toContainText(
    "last: batch.completed",
  );
});

test("reports a folder without supported images as a 422", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Batch Processing" }).click();

  await page.fill("#batch-input-dir", uiPath(EMPTY_DIR));
  await page.getByRole("button", { name: "Run Batch Generation" }).click();

  const error = page.getByTestId("batch-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("No supported images found in");
  // The server names the directory it resolved, inside the container.
  expect(toPosix((await error.textContent()) ?? "")).toContain(
    containerPath(EMPTY_DIR),
  );

  // No partial results are presented as success.
  await expect(page.getByTestId("batch-row")).toHaveCount(0);
});
