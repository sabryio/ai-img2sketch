import { existsSync, readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  BATCH_DIR,
  ensureFixtures,
  hostPathFromBackend,
  hostPathOf,
  SINGLE_IMAGE,
} from "./fixtures";
import { openWorkspace } from "./helpers";

/**
 * The browser picker, end to end.
 *
 * A browser cannot hand the container a host path — the picked file only exists
 * as bytes — so the app stages them through `POST /api/v1/media` and uses the
 * path the backend reports back. Both specs follow a staged file all the way to
 * the MP4, and assert on disk as well as on the DOM, so neither the upload nor
 * the mapping can be faked.
 */

const STAGED_IMAGE = /^\/app\/media\/uploads\/hand-mask-[0-9a-f]{8}\.png$/;

test.beforeAll(() => {
  ensureFixtures();
});

test("stages an image picked in the browser and sketches it", async ({
  page,
}) => {
  await openWorkspace(page);

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Pick Image" }).click(),
  ]);
  await chooser.setFiles(SINGLE_IMAGE);

  // The field holds the path the backend reported: already inside the mounted
  // media volume, so nothing else has to be copied on submit.
  const imageField = page.locator("#single-image-path");
  await expect(imageField).toHaveValue(STAGED_IMAGE);

  const stagedBackendPath = (await imageField.inputValue()).trim();
  expect(existsSync(hostPathFromBackend(stagedBackendPath))).toBe(true);

  // The mapping preview agrees the container can read it as-is.
  await expect(page.getByText("Backend Path Mapping (docker):")).toBeVisible();
  await expect(page.getByText(stagedBackendPath).first()).toBeVisible();

  await page.getByRole("button", { name: "Generate Sketch Video" }).click();

  // No `output_dir`, so the video is written beside the staged image — which
  // puts it in the host's `./media/uploads`.
  const outputPath = page.getByTestId("single-output-path");
  await expect(outputPath).toBeVisible();
  const producedPath = (await outputPath.textContent())!.trim();

  expect(producedPath).toMatch(
    /^\.\/media\/uploads\/hand-mask-[0-9a-f]{8}\.mp4$/,
  );
  expect(existsSync(hostPathOf(producedPath))).toBe(true);
});

test("stages a folder picked in the browser and processes every image", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Batch Processing" }).click();

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Select Folder" }).click(),
  ]);
  // A `webkitdirectory` input takes a directory: the browser then reports every
  // image inside it, exactly as a real folder pick would.
  await chooser.setFiles(BATCH_DIR);

  // One bucket holds the whole folder, so the app can hand the backend the
  // folder it owns.
  const inputField = page.locator("#batch-input-dir");
  await expect(inputField).toHaveValue(/^\/app\/media\/uploads\/[a-z0-9-]+$/);

  const bucket = (await inputField.inputValue()).trim();
  expect(readdirSync(hostPathFromBackend(bucket))).toHaveLength(2);

  await expect(
    page
      .getByRole("complementary", { name: "Notifications" })
      .getByText("Folder Uploaded"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Run Batch Generation" }).click();

  const rows = page.getByTestId("batch-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Success");
  await expect(rows.nth(1)).toContainText("Success");

  // Each video is written next to its staged image, inside the volume.
  await expect(rows.first()).toContainText("./media/uploads/");
  await expect(page.getByTestId("batch-summary")).toContainText("2 Succeeded");
});
