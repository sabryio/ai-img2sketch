import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createFixtures, DOWNLOAD_DIR, type Fixtures } from "./fixtures";
import { openWorkspace, stubSavePicker } from "./helpers";

/**
 * Downloading a produced video.
 *
 * The backend writes inside its own container, and a browser cannot read those
 * paths. The app therefore fetches the bytes from `GET /api/v1/artifacts/download`
 * and hands them to the browser's own save UI. The spec captures that download
 * and inspects the MP4 on disk, so a UI that only *looked* like it saved
 * something could not pass.
 *
 * What Playwright saves is exactly what the API served: nothing is copied out of
 * the container on the way.
 */
let fixtures: Fixtures;

test.beforeAll(async ({ request }) => {
  fixtures = await createFixtures(request);
});

test.beforeEach(async ({ page }) => {
  await stubSavePicker(page);
});

test("downloads a produced video to the machine", async ({ page }) => {
  await openWorkspace(page);

  await page.fill("#single-image-path", fixtures.singleImage);
  await page.getByRole("button", { name: "Generate Sketch Video" }).click();

  await expect(page.getByTestId("single-output-path")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("single-download").click(),
  ]);

  // Named after the file the backend produced, whatever the browser does with it.
  const producedName = fixtures.singleVideo.split("/").pop() ?? "";
  expect(download.suggestedFilename()).toBe(producedName);
  expect(producedName).toMatch(/\.mp4$/);

  const saved = join(DOWNLOAD_DIR, "downloaded-hand-mask.mp4");
  await download.saveAs(saved);

  expect(statSync(saved).size).toBeGreaterThan(0);
  // Byte 4 of an MP4 is the start of the `ftyp` box: a real container, not a stub.
  expect(readFileSync(saved).subarray(4, 8).toString("ascii")).toBe("ftyp");
});
