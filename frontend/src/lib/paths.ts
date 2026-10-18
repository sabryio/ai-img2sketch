/**
 * Path mapping rules for Docker vs Sidecar modes.
 *
 * Docker mode:
 * - The backend container only sees mounted volumes:
 *   - /app/media  -> mapped to host <project-root>/media
 *   - /app/output -> mapped to host <project-root>/output
 * - Picked host files must be placed/copied into the media folder so Docker can read them.
 * - Result paths returned as `/app/output/<filename>` must be mapped back to `<project-root>/output/<filename>`.
 *
 * Sidecar mode:
 * - The backend runs as a native host binary (`img2sketch-api`) with direct filesystem access.
 * - Request paths and output paths are plain local paths as-is.
 */

/**
 * How the backend is reached:
 * - `docker` — container with the `./media` and `./output` volumes mounted
 * - `sidecar` — native process with direct access to host paths
 */
export type BackendMode = "docker" | "sidecar";

export interface PathConfig {
  projectRoot: string;
  mediaSubdir: string;
  outputSubdir: string;
}

export const DEFAULT_PATH_CONFIG: PathConfig = {
  projectRoot: ".",
  mediaSubdir: "media",
  outputSubdir: "output",
};

/**
 * Normalizes slashes in a path to forward slashes.
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Joins two fragments with exactly one slash (no resolution). */
function joinFragments(parent: string, child: string): string {
  return normalizePath(`${parent}/${child}`)
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}

/** Drops a leading `./` so `./media/x` and `media/x` compare equal. */
function stripDotSlash(p: string): string {
  return p.replace(/^\.\//, "");
}

/**
 * Returns the subpath of `path` inside `dir`, `""` when they are the same, or
 * `null` when `path` is not inside `dir`. String-based: host paths can be
 * relative (`./media/...`), so no filesystem resolution is involved.
 */
function relativeInside(path: string, dir: string): string | null {
  const normalizedDir = stripDotSlash(dir);
  const normalizedPath = stripDotSlash(path);
  if (normalizedPath === normalizedDir) {
    return "";
  }
  if (normalizedPath.startsWith(`${normalizedDir}/`)) {
    return normalizedPath.slice(normalizedDir.length + 1);
  }
  return null;
}

/**
 * Extracts the base filename from a path (e.g., "/path/to/cat.png" -> "cat.png").
 */
export function getBasename(filePath: string): string {
  const norm = normalizePath(filePath);
  const parts = norm.split("/");
  return parts[parts.length - 1] || filePath;
}

/**
 * Converts a picked local host path to the path expected by the backend,
 * based on whether Docker mode or Sidecar mode is active.
 *
 * In Docker mode a path that is **already** inside the mounted media folder
 * keeps its subpath and needs no copy — the container reads it where it is.
 * Only files from elsewhere have to be staged, and those are flattened to the
 * top of the volume because that is the one name guaranteed to be free.
 */
export function mapHostPathToBackend(
  hostPath: string,
  mode: BackendMode,
  config: PathConfig = DEFAULT_PATH_CONFIG,
): { backendPath: string; needsCopy: boolean; destinationHostPath?: string } {
  const norm = normalizePath(hostPath.trim());
  if (!norm) {
    return { backendPath: "", needsCopy: false };
  }

  if (mode === "sidecar") {
    return { backendPath: norm, needsCopy: false };
  }

  // Already addressed the way the container sees it.
  if (norm === "/app/media" || norm.startsWith("/app/media/")) {
    return { backendPath: norm, needsCopy: false };
  }

  const hostMediaDir = joinFragments(config.projectRoot, config.mediaSubdir);

  // Already staged inside the mounted folder (repo-relative `./media/...` or an
  // absolute `<project-root>/media/...`): no copy, and the subpath survives.
  const staged = relativeInside(norm, hostMediaDir);
  if (staged === "") {
    return { backendPath: "/app/media", needsCopy: false };
  }
  if (staged !== null) {
    return { backendPath: joinFragments("/app/media", staged), needsCopy: false };
  }

  const filename = getBasename(norm);
  return {
    backendPath: `/app/media/${filename}`,
    needsCopy: true,
    destinationHostPath: joinFragments(hostMediaDir, filename),
  };
}

/**
 * Converts an output directory to the path the backend should write to.
 *
 * Docker mode can only write inside `/app/output`, so a relative `./output/...`
 * (the documented default) or an absolute `<project-root>/output/...` becomes
 * `/app/output/...`, and a container path is kept as-is. A directory outside the
 * mount is passed through unchanged: the UI does not silently redirect a
 * location the user never staged into the volume, so the request fails loudly
 * instead of writing somewhere unexpected.
 */
export function mapOutputDirToBackend(
  outputDir: string,
  mode: BackendMode,
  config: PathConfig = DEFAULT_PATH_CONFIG,
): string {
  const norm = normalizePath(outputDir.trim());
  if (!norm || mode === "sidecar") {
    return norm;
  }

  if (norm === "/app/output" || norm.startsWith("/app/output/")) {
    return norm;
  }

  const hostOutputDir = joinFragments(config.projectRoot, config.outputSubdir);
  const relative = relativeInside(norm, hostOutputDir);
  if (relative === null) {
    return norm;
  }
  return relative ? joinFragments("/app/output", relative) : "/app/output";
}

/**
 * Converts an output path returned by the backend back to the host filesystem path.
 */
export function mapBackendPathToHost(
  backendPath: string,
  mode: BackendMode,
  config: PathConfig = DEFAULT_PATH_CONFIG,
): string {
  const norm = normalizePath(backendPath.trim());
  if (!norm) return "";

  if (mode === "sidecar") {
    return norm;
  }

  // Docker mode: map `/app/output/...` back to `<projectRoot>/output/...`
  if (norm.startsWith("/app/output/")) {
    const rel = norm.replace("/app/output/", "");
    return joinFragments(
      joinFragments(config.projectRoot, config.outputSubdir),
      rel,
    );
  }

  if (norm.startsWith("/app/media/")) {
    const rel = norm.replace("/app/media/", "");
    return joinFragments(
      joinFragments(config.projectRoot, config.mediaSubdir),
      rel,
    );
  }

  return norm;
}
