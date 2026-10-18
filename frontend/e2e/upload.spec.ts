import { expect, test } from "@playwright/test";
import {
  artifactUrl,
  PICK_DIR,
  PICK_IMAGE,
  preparePickDirectory,
} from "./fixtures";
import { openWorkspace } from "./helpers";

/**
 * The browser picker, end to end.
 *
 * A browser cannot hand the backend a host path — the picked file only exists as
 * bytes — so the app stages them through `POST /api/v1/media` and uses the path
 * the API reports back. The first two specs follow a staged file all the way to
 * the MP4; the third checks the other half of the promise: what was uploaded can
 * be removed again, so nothing has to be left on the backend.
 */

const STAGED_IMAGE = /^\/app\/media\/uploads\/hand-mask-[0-9a-f]{8}\.png$/;

test.beforeAll(() => {
  preparePickDirectory();
});

test("stages an image picked in the browser and sketches it", async ({
  page,
  request,
}) => {
  await openWorkspace(page);

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Pick Image" }).click(),
  ]);
  await chooser.setFiles(PICK_IMAGE);

  // The field holds the path the backend reported: a path the container owns, so
  // nothing else has to be sent on submit.
  const imageField = page.locator("#single-image-path");
  await expect(imageField).toHaveValue(STAGED_IMAGE);

  const stagedPath = (await imageField.inputValue()).trim();

  // The mapping preview agrees the container can read it as-is.
  await expect(page.getByText("Backend Path (docker):")).toBeVisible();
  await expect(
    page.getByText(stagedPath, { exact: false }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Generate Sketch Video" }).click();

  // No `output_dir`, so the video is written beside the staged image.
  const outputPath = page.getByTestId("single-output-path");
  await expect(outputPath).toBeVisible();
  const producedPath = (await outputPath.textContent())!.trim();

  expect(producedPath).toBe(stagedPath.replace(/\.png$/, ".mp4"));
  expect((await request.get(artifactUrl(producedPath))).ok()).toBe(true);

  // The upload is kept until the user says otherwise: what was picked is still
  // on the backend, and the button that removes it is on offer.
  expect((await request.get(artifactUrl(stagedPath))).ok()).toBe(true);
  await expect(page.getByTestId("single-delete-uploads")).toBeVisible();
});

test("stages a folder picked in the browser and processes every image", async ({
  page,
  request,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Batch Processing" }).click();

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Select Folder" }).click(),
  ]);
  // A `webkitdirectory` input takes a directory: the browser then reports every
  // image inside it, exactly as a real folder pick would.
  await chooser.setFiles(PICK_DIR);

  // One bucket holds the whole folder, so the app can hand the backend the
  // folder it owns.
  const inputField = page.locator("#batch-input-dir");
  await expect(inputField).toHaveValue(/^\/app\/media\/uploads\/[a-z0-9-]+$/);

  const bucket = (await inputField.inputValue()).trim();

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

  // Each video is written next to its staged image, inside the bucket, and the
  // API really serves both of them.
  const outputs = await rows
    .locator('[data-testid="batch-output-path"]')
    .allTextContents();
  expect(outputs).toHaveLength(2);
  for (const output of outputs) {
    expect(output).toContain(`${bucket}/`);
    expect(output).toMatch(/\.mp4$/);
    expect((await request.get(artifactUrl(output.trim()))).ok()).toBe(true);
  }

  await expect(page.getByTestId("batch-summary")).toContainText("2 Succeeded");
});

test("removes a staged upload from the backend when asked", async ({
  page,
  request,
}) => {
  await openWorkspace(page);

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Pick Image" }).click(),
  ]);
  await chooser.setFiles(PICK_IMAGE);

  // The upload is a round trip: wait for the field to hold what the API
  // reported before reading it.
  const imageField = page.locator("#single-image-path");
  await expect(imageField).toHaveValue(STAGED_IMAGE);

  const stagedPath = (await imageField.inputValue()).trim();
  expect((await request.get(artifactUrl(stagedPath))).ok()).toBe(true);

  await page.getByTestId("single-delete-uploads").click();

  await expect(page.getByText("Uploads deleted").first()).toBeVisible();
  // The field pointed at a file that no longer exists, so it is cleared rather
  // than left to fail on the next run.
  await expect(page.locator("#single-image-path")).toHaveValue("");
  await expect
    .poll(async () => (await request.get(artifactUrl(stagedPath))).status())
    .toBe(404);
});
