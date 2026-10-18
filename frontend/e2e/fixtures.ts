import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the specs get their inputs from.
 *
 * The app defaults to Docker mode, and a container can only see the two compose
 * mounts (`./media`, `./output`). Fixtures therefore live inside them, in a
 * suite-owned slice (`media/e2e`, `output/e2e`) that `ensureFixtures` wipes — it
 * never touches the rest of `media/` or `output/`. The images themselves are
 * copied from the repository, so no binaries are committed.
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Host side of the compose bind mounts. */
export const MEDIA_ROOT = join(REPO_ROOT, "media");
export const OUTPUT_ROOT = join(REPO_ROOT, "output");

/** Suite-owned workspace, visible in the container as `/app/media/e2e`. */
export const WORKSPACE = join(MEDIA_ROOT, "e2e");

/** Directory handed to `POST /sketches/batch` (host path). */
export const BATCH_DIR = join(WORKSPACE, "batch");

/** Directory handed to `output_dir` (host path). */
export const OUTPUT_DIR = join(OUTPUT_ROOT, "e2e");

/** A directory that exists but holds no images (422 case). */
export const EMPTY_DIR = join(WORKSPACE, "empty");

/** Where `POST /api/v1/media` stages browser-picked files (host side). */
export const UPLOADS_DIR = join(MEDIA_ROOT, "uploads");

/** Image used by the single-sketch spec (host path). */
export const SINGLE_IMAGE = join(BATCH_DIR, "hand-mask.png");

/** A path no filesystem has (404 case). */
export const MISSING_IMAGE = join(WORKSPACE, "missing", "no-such-image.png");

/** Repo images copied into the workspace, in batch order. */
const SOURCES = ["hand-mask.png", "drawing-hand.png"] as const;

/**
 * The repo-relative form a user types into the UI, e.g. `./media/e2e/batch`.
 *
 * `DEFAULT_PATH_CONFIG.projectRoot` is `"."`, so this is exactly what
 * `lib/paths.ts` maps onto `/app/media/...` without needing a copy.
 */
export function uiPath(hostPath: string): string {
  const rel = relative(REPO_ROOT, hostPath).replaceAll("\\", "/");
  if (!rel.startsWith("media/") && !rel.startsWith("output/")) {
    throw new Error(`Not inside a compose mount: ${hostPath}`);
  }
  return `./${rel}`;
}

/** Absolute host path behind a path the UI displayed (`./media/...`). */
export function hostPathOf(displayed: string): string {
  return join(REPO_ROOT, displayed.replace(/^\.\//, ""));
}

/**
 * Host path behind a path the *backend* reported (`/app/media/...`), which is
 * where uploads land before the UI maps them back for display.
 */
export function hostPathFromBackend(backendPath: string): string {
  const normalized = toPosix(backendPath);
  if (normalized.startsWith("/app/media/")) {
    return join(MEDIA_ROOT, normalized.slice("/app/media/".length));
  }
  if (normalized.startsWith("/app/output/")) {
    return join(OUTPUT_ROOT, normalized.slice("/app/output/".length));
  }
  throw new Error(`Not inside a compose mount: ${backendPath}`);
}

/** The path the container sees for one of the mounts (`/app/media/...`). */
export function containerPath(hostPath: string): string {
  const rel = relative(REPO_ROOT, hostPath).replaceAll("\\", "/");
  if (rel.startsWith("media/")) {
    return `/app/media/${rel.slice("media/".length)}`;
  }
  if (rel.startsWith("output/")) {
    return `/app/output/${rel.slice("output/".length)}`;
  }
  throw new Error(`Not inside a compose mount: ${hostPath}`);
}

/**
 * Windows separators become `/` on the way out: `lib/paths.ts` normalizes every
 * path it maps, so both the request and the displayed result use forward
 * slashes (which Windows accepts anywhere).
 */
export function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Create the workspace, copying the source images in. Idempotent. */
export function ensureFixtures(): void {
  rmSync(WORKSPACE, { recursive: true, force: true });
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  // Uploads are staged by the app during a run, so the next run starts clean
  // instead of accumulating one folder per folder pick.
  rmSync(UPLOADS_DIR, { recursive: true, force: true });
  mkdirSync(BATCH_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(EMPTY_DIR, { recursive: true });

  for (const name of SOURCES) {
    const source = join(REPO_ROOT, "images", name);
    if (!existsSync(source)) {
      throw new Error(`Missing fixture source: ${source}`);
    }
    copyFileSync(source, join(BATCH_DIR, name));
  }
}
