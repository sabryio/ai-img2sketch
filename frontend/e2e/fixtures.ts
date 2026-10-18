import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext } from "@playwright/test";

/**
 * Where the specs get their inputs from.
 *
 * The app runs in Docker mode, and the container has no host mounts: a file only
 * exists for the backend once it has been *uploaded*. So a fixture is not a path
 * on disk as far as the spec is concerned — it is the answer of
 * `POST /api/v1/media`, which is exactly what a user clicking "Pick Image" gets.
 * `createFixtures` therefore uploads the repository's images through the API and
 * hands the specs the container paths that came back.
 *
 * Uploads land in a suite-owned bucket under the media volume (`uploads/e2e-…`),
 * one per run, so a spec always works with exactly the images it uploaded — and
 * never with files an earlier run left in the container.
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The backend the suite talks to directly. `use.baseURL` points at the Vite dev
 * server, so the API origin is spelled out here (and overridable for a stack
 * that runs somewhere else).
 */
const API_ORIGIN = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:8000";

/** Host folder the suite uses for files it downloads (Playwright writes it). */
export const DOWNLOAD_DIR = join(REPO_ROOT, "output", "e2e");

/** Bucket every fixture upload lands in, fresh per run: see `createFixtures`. */
function newFixtureBucket(): string {
  return `e2e-${Date.now().toString(16)}${Math.floor(Math.random() * 0xffff).toString(16)}`;
}

/**
 * Container directory that exists but holds no images of its own: the media
 * volume root, whose only entry is the `uploads` folder.
 */
export const NO_IMAGES_DIR = "/app/media";

/** Repo images uploaded as fixtures, in batch order (name ascending). */
const SOURCES = ["drawing-hand.png", "hand-mask.png"] as const;

/** Repo image a browser's file picker selects (the single-sketch input). */
const SINGLE_SOURCE = "hand-mask.png";

/**
 * Host folder holding a copy of the fixture images.
 *
 * The container never sees it: it exists only because a browser's own file
 * picker reads from the host, so `setFiles` needs a real host path.
 */
export const PICK_DIR = join(REPO_ROOT, "output", "e2e-inputs");

/** Host path of the image a browser's file picker selects. */
export const PICK_IMAGE = join(PICK_DIR, SINGLE_SOURCE);

/** Create the host folder a browser's folder picker is pointed at. */
export function preparePickDirectory(): void {
  mkdirSync(PICK_DIR, { recursive: true });
  for (const name of SOURCES) {
    copyFileSync(join(REPO_ROOT, "images", name), join(PICK_DIR, name));
  }
}

/** The paths a spec works with, as the container sees them. */
export interface Fixtures {
  /** Uploaded image for the single-sketch specs. */
  singleImage: string;
  /** Uploaded image for the batch specs (the other one of the pair). */
  batchImage: string;
  /** Container directory holding both uploaded images. */
  batchDir: string;
  /** Video the backend writes beside `singleImage` when no `output_dir` is sent. */
  singleVideo: string;
  /** Video the backend writes beside `batchImage` when no `output_dir` is sent. */
  batchVideo: string;
  /** Path in a container directory, holding nothing (404 case). */
  missingImage: string;
}

/** Parent directory of a container path. */
function containerParent(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

/** The video path the backend derives from an image path. */
function videoFor(imagePath: string): string {
  return imagePath.replace(/\.[^./]+$/, ".mp4");
}

/** Wait for the API to answer, so a fixture failure reads as one. */
async function waitForApi(api: APIRequestContext): Promise<void> {
  const health = await api.get(`${API_ORIGIN}/api/v1/health`);
  if (!health.ok()) {
    throw new Error(
      `Backend is not answering (${health.status()}). Start it with \`docker compose up -d\`.`,
    );
  }
}

/**
 * Upload the fixture images and return the paths the backend reported.
 *
 * Every run gets its own bucket under the media volume, so the batch specs never
 * pick up files an earlier run left behind — the container's scratch space is
 * wiped on restart, but not between runs of the suite.
 */
export async function createFixtures(api: APIRequestContext): Promise<Fixtures> {
  await waitForApi(api);

  const bucket = newFixtureBucket();
  const uploaded: string[] = [];
  for (const name of SOURCES) {
    const source = join(REPO_ROOT, "images", name);
    if (!existsSync(source)) {
      throw new Error(`Missing fixture source: ${source}`);
    }

    const response = await api.post(`${API_ORIGIN}/api/v1/media`, {
      data: {
        filename: name,
        content_base64: readFileSync(source).toString("base64"),
        directory: bucket,
      },
    });
    if (!response.ok()) {
      throw new Error(
        `Could not upload ${name} (${response.status()}): ${await response.text()}`,
      );
    }

    const stored = (await response.json()) as { path: string };
    uploaded.push(stored.path);
  }

  const [batchImage, singleImage] = uploaded;
  if (!batchImage || !singleImage) {
    throw new Error("Expected two uploaded fixture images");
  }

  return {
    singleImage,
    batchImage,
    batchDir: containerParent(singleImage),
    singleVideo: videoFor(singleImage),
    batchVideo: videoFor(batchImage),
    missingImage: `${containerParent(singleImage)}/no-such-image.png`,
  };
}

/**
 * Windows separators become `/` on the way out: the app normalizes every path it
 * sends, so requests and the answers it displays use forward slashes (which
 * Windows accepts anywhere).
 */
export function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

/** `GET /api/v1/artifacts/download` for a container path, as the app builds it. */
export function artifactUrl(
  path: string,
  disposition: "attachment" | "inline" = "attachment",
): string {
  const query = new URLSearchParams({ path, disposition });
  return `${API_ORIGIN}/api/v1/artifacts/download?${query.toString()}`;
}

/** `DELETE /api/v1/artifacts` for a container path. */
export function artifactDeleteUrl(path: string): string {
  const query = new URLSearchParams({ path });
  return `${API_ORIGIN}/api/v1/artifacts?${query.toString()}`;
}
