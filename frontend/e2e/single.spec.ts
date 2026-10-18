import { expect, test } from "@playwright/test";
import { artifactUrl, createFixtures, type Fixtures } from "./fixtures";
import { openEventLog, openWorkspace } from "./helpers";

/**
 * The whole single-sketch path, end to end, in the default Docker mode: the typed
 * path is one the backend can already read, the container renders a real MP4
 * inside its own directory, and the lifecycle events arrive over SSE.
 *
 * The spec asserts against the API as well as the DOM — it fetches the produced
 * file back, and after a delete it asserts the file is really gone — so a UI that
 * only *looked* like it produced (or removed) something could not pass.
 */
let fixtures: Fixtures;

test.beforeAll(async ({ request }) => {
  fixtures = await createFixtures(request);
});

test("generates a sketch video and reports it on the event stream", async ({
  page,
  request,
}) => {
  await openWorkspace(page);

  await page.fill("#single-image-path", fixtures.singleImage);

  // The preview says what the backend sees, and that this path needs no upload:
  // it is the one the API returned from the fixture upload.
  await expect(page.getByText("Backend Path (docker):")).toBeVisible();
  await expect(
    page.getByText(fixtures.singleImage, { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/uploaded to the backend when the run starts/),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Generate Sketch Video" }).click();

  // Result card, carrying the path the backend wrote. With no `output_dir` the
  // video lands next to the source image, inside the container.
  const outputPath = page.getByTestId("single-output-path");
  await expect(outputPath).toBeVisible();
  const producedPath = (await outputPath.textContent())!.trim();

  expect(producedPath).toBe(fixtures.singleVideo);
  // The file is real: the API serves it inline as a video.
  const served = await request.get(artifactUrl(producedPath, "inline"));
  expect(served.ok()).toBe(true);
  expect(served.headers()["content-type"]).toContain("video/mp4");

  // Success is announced once, through the mutation result (the result card
  // carries a longer version of the same words, so scope to the toast stack).
  await expect(
    page
      .getByRole("complementary", { name: "Notifications" })
      .getByText("Sketch Video Generated"),
  ).toBeVisible();

  // The live query saw the newest event, and the accumulator saw them all.
  await expect(page.getByTestId("sse-badge")).toContainText("SSE Live");
  await openEventLog(page);
  const log = page.getByTestId("event-log");
  await expect(log).toContainText("sketch.started");
  await expect(log).toContainText("sketch.progress");
  await expect(log).toContainText("sketch.completed");
  await expect(log).toContainText("hand-mask");
  await expect(page.getByTestId("sse-state")).toContainText(
    "last: sketch.completed",
  );
});

test("deletes a produced video from the backend on request", async ({
  page,
  request,
}) => {
  await openWorkspace(page);

  await page.fill("#single-image-path", fixtures.singleImage);
  await page.getByRole("button", { name: "Generate Sketch Video" }).click();

  const outputPath = page.getByTestId("single-output-path");
  await expect(outputPath).toBeVisible();
  const producedPath = (await outputPath.textContent())!.trim();

  // It is really there before the delete…
  expect((await request.get(artifactUrl(producedPath))).ok()).toBe(true);

  await page.getByTestId("single-delete").click();

  // …and really gone afterwards, which is the point of the button: keeping the
  // file is a choice, not an accident.
  await expect(page.getByText("Deleted from the backend").first()).toBeVisible();
  await expect(page.getByTestId("single-download")).toBeDisabled();
  await expect
    .poll(async () => (await request.get(artifactUrl(producedPath))).status())
    .toBe(404);
});

test("rejects a path the container cannot see with a 404 explanation", async ({
  page,
}) => {
  await openWorkspace(page);

  await page.fill("#single-image-path", fixtures.missingImage);
  await page.getByRole("button", { name: "Generate Sketch Video" }).click();

  const error = page.getByTestId("single-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("Request Error 404");
  await expect(error).toContainText("only reads files that were uploaded");
  await expect(error).toContainText(fixtures.missingImage);

  // The form is usable again: a failure must not wedge the view.
  await expect(
    page.getByRole("button", { name: "Generate Sketch Video" }),
  ).toBeEnabled();
});
