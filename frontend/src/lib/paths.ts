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
 * The two volumes the container mounts, as `[host dir, container dir]` pairs.
 */
function mountPairs(config: PathConfig): Array<[string, string]> {
  return [
    [joinFragments(config.projectRoot, config.mediaSubdir), "/app/media"],
    [joinFragments(config.projectRoot, config.outputSubdir), "/app/output"],
  ];
}

/**
 * Maps a path that is already inside one of the mounts to its container form,
 * or `null` when it is inside neither. Both mounts count: videos are written
 * beside their image (`./media/...`) by default, and into `./output/...` when
 * the user asks for it.
 */
function mapInsideMounts(norm: string, config: PathConfig): string | null {
  for (const [hostDir, containerDir] of mountPairs(config)) {
    const relative = relativeInside(norm, hostDir);
    if (relative !== null) {
      return relative ? joinFragments(containerDir, relative) : containerDir;
    }
  }
  return null;
}

/**
 * Converts an output directory to the path the backend should write to.
 *
 * Docker mode can only write inside its volumes, so a relative `./output/...`
 * (the documented default), an absolute `<project-root>/output/...` or a folder
 * beside the image (`./media/...`) becomes its `/app/...` form, and a container
 * path is kept as-is. A folder outside the volumes is also passed through
 * unchanged: the UI does not silently redirect a location the user never staged
 * into the container (see {@link planOutput}, which decides what to do about it).
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

  // Already addressed the way the container sees it.
  if (norm === "/app" || norm.startsWith("/app/")) {
    return norm;
  }

  return mapInsideMounts(norm, config) ?? norm;
}

/** Why a typed output folder is not handed to the backend as `output_dir`. */
export type OutputNote =
  /** Outside the volumes: render in the volume, the desktop app copies it out. */
  | "exported"
  /** Outside the volumes, and a browser cannot copy: the user downloads it. */
  | "download";

/**
 * What the frontend will do with the output folder the user typed.
 *
 * Docker mode adds a constraint the CLI does not have: the container can only
 * write into its two volumes. A folder outside them still works, but in two
 * steps — render inside the volume, then hand the file to the host. The desktop
 * app copies it; a browser offers a download, because it cannot write to a host
 * path on its own.
 */
export interface OutputPlan {
  /** `output_dir` to send; `undefined` means "beside the selected image". */
  backendOutputDir?: string;
  /** Host folder that receives the videos after rendering. */
  exportDir?: string;
  /** Why the typed folder is not sent to the backend. */
  note?: OutputNote;
}

/**
 * Decide between "the backend writes there" and "the host receives it after".
 *
 * @param canExportToHost - true in the desktop shell, which can copy a produced
 *   file into any host folder; false in a browser, which can only hand the bytes
 *   to its own download UI.
 */
export function planOutput(
  outputDir: string,
  mode: BackendMode,
  canExportToHost: boolean,
  config: PathConfig = DEFAULT_PATH_CONFIG,
): OutputPlan {
  const norm = normalizePath(outputDir.trim());
  if (!norm) {
    return {};
  }

  // A native backend has direct filesystem access: it writes where it is told.
  if (mode === "sidecar") {
    return { backendOutputDir: norm };
  }

  const mapped = mapOutputDirToBackend(norm, mode, config);
  const insideVolumes =
    mapped !== norm || norm === "/app" || norm.startsWith("/app/");
  if (insideVolumes) {
    return { backendOutputDir: mapped };
  }

  // A host folder the container cannot reach: render in the volume, then move
  // the result out.
  return {
    exportDir: norm,
    note: canExportToHost ? "exported" : "download",
  };
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
