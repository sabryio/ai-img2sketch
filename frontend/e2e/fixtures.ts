import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the specs get their inputs from.
 *
 * Two small images that already live in the repository are copied out to a temp
 * workspace, so the suite commits no binaries of its own and never writes into
 * the repo. The backend reads them straight off the host (sidecar mode, which is
 * also the default in a browser — see `stores/backend.ts`).
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Temp workspace shared by every spec. */
export const WORKSPACE = join(tmpdir(), "ai-img2sketch-e2e");

/** Directory handed to `POST /sketches/batch`. */
export const BATCH_DIR = join(WORKSPACE, "batch");

/** Directory handed to `output_dir`. */
export const OUTPUT_DIR = join(WORKSPACE, "output");

/** A directory that exists but holds no images (422 case). */
export const EMPTY_DIR = join(WORKSPACE, "empty");

/** Image used by the single-sketch spec. */
export const SINGLE_IMAGE = join(BATCH_DIR, "hand-mask.png");

/** A path no filesystem has (404 case). */
export const MISSING_IMAGE = join(WORKSPACE, "missing", "no-such-image.png");

/** Repo images copied into the workspace, in batch order. */
const SOURCES = ["hand-mask.png", "drawing-hand.png"] as const;

/**
 * Windows separators become `/` on the way out: `lib/paths.ts` normalizes every
 * path it maps, and the backend echoes that form back in `output_path`, so the
 * UI shows forward slashes (which Windows accepts anywhere).
 */
export function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Create the workspace, copying the source images in. Idempotent. */
export function ensureFixtures(): void {
  rmSync(WORKSPACE, { recursive: true, force: true });
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
