import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ensureFixtures, OUTPUT_DIR, SINGLE_IMAGE, uiPath } from "./fixtures";
import { openWorkspace, stubSavePicker } from "./helpers";

/**
 * Downloading a produced video.
 *
 * The backend writes inside its volumes, and a browser cannot read those paths.
 * The app therefore fetches the bytes from `GET /api/v1/artifacts/download` and
 * hands them to the browser's own save UI. The spec captures that download and
 * inspects the MP4 on disk, so a UI that only *looked* like it saved something
 * could not pass.
 *
 * The container renders the video, the host never sees a temporary copy in the
 * test: what Playwright saves is exactly what the API served.
 */
test.beforeAll(() => {
  ensureFixtures();
});

test.beforeEach(async ({ page }) => {
  await stubSavePicker(page);
});

test("downloads a produced video to the machine", async ({ page }) => {
  await openWorkspace(page);

  await page.fill("#single-image-path", uiPath(SINGLE_IMAGE));
  await page.getByRole("button", { name: "Generate Sketch Video" }).click();

  await expect(page.getByTestId("single-output-path")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("single-download").click(),
  ]);

  // Named after the file the backend produced, whatever the browser does with it.
  expect(download.suggestedFilename()).toBe("hand-mask.mp4");

  const saved = join(OUTPUT_DIR, "downloaded-hand-mask.mp4");
  await download.saveAs(saved);

  expect(statSync(saved).size).toBeGreaterThan(0);
  // Byte 4 of an MP4 is the start of the `ftyp` box: a real container, not a stub.
  expect(readFileSync(saved).subarray(4, 8).toString("ascii")).toBe("ftyp");
});
