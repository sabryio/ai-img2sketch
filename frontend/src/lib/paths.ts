/**
 * Where files live, per backend mode.
 *
 * Docker mode
 * -----------
 * The container has no view of the host filesystem: it owns two directories of
 * its own (`/app/media` for uploads, `/app/output` for renders) and nothing
 * else. So a host path is not a path the backend can be handed — it is a file
 * to *read and upload* first, after which the API answers with the path it now
 * lives at. The same is true in the other direction: a produced video stays in
 * the container until the client downloads it.
 *
 * Sidecar mode
 * ------------
 * The backend is a native process on this machine, so host paths are handed
 * over as-is, in both directions.
 */

/**
 * How the backend is reached:
 * - `docker` — container that can only see what the client uploads
 * - `sidecar` — native process with direct access to host paths
 */
export type BackendMode = "docker" | "sidecar";

/** Prefix of the directories the Docker backend owns. */
const CONTAINER_ROOT = "/app";

/** Normalizes slashes in a path to forward slashes. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
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
 * True when the backend can open this path where it is.
 *
 * A sidecar process reads host paths directly. A container only reads its own
 * directories, so anything else has to be uploaded first.
 */
export function isBackendPath(path: string, mode: BackendMode): boolean {
  if (mode === "sidecar") {
    return true;
  }
  const norm = normalizePath(path.trim());
  return norm === CONTAINER_ROOT || norm.startsWith(`${CONTAINER_ROOT}/`);
}

/** What has to happen to an input before the backend can read it. */
export interface InputPathPlan {
  /** Path to send once any upload has happened. */
  path: string;
  /** True when the bytes must be uploaded first (see `stageFiles`). */
  needsUpload: boolean;
}

/**
 * Decide whether an input path can be sent as-is or has to be uploaded.
 *
 * Docker mode says "upload" for anything that is not already a container path —
 * including a path that happens to be inside the project, because the container
 * cannot see the project either. A path the API itself returned from an earlier
 * upload is already a container path and is sent unchanged.
 */
export function planInputPath(input: string, mode: BackendMode): InputPathPlan {
  const trimmed = normalizePath(input.trim());
  if (!trimmed) {
    return { path: "", needsUpload: false };
  }

  return { path: trimmed, needsUpload: !isBackendPath(trimmed, mode) };
}

/** Why a typed output folder is not handed to the backend as `output_dir`. */
export type OutputNote =
  /** Outside the container: render inside it, the desktop app copies it out. */
  | "exported"
  /** Outside the container, and a browser cannot copy: the user downloads it. */
  | "download";

/** What the frontend will do with the output folder the user typed. */
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
 * Docker mode adds a constraint the CLI does not have: the container can only
 * write into its own directories. A host folder still works, but in two steps —
 * render inside the container, then hand the file to the host. The desktop app
 * writes it straight into the folder; a browser offers a download, because a
 * page cannot write to a host path on its own.
 *
 * @param canExportToHost - true in the desktop shell, which can write a fetched
 *   file into any host folder; false in a browser, which can only hand the bytes
 *   to its own download UI.
 */
export function planOutput(
  outputDir: string,
  mode: BackendMode,
  canExportToHost: boolean,
): OutputPlan {
  const norm = normalizePath(outputDir.trim());
  if (!norm) {
    return {};
  }

  // A native backend has direct filesystem access: it writes where it is told.
  if (mode === "sidecar") {
    return { backendOutputDir: norm };
  }

  // Only the container's own directory can be handed over unchanged.
  if (norm === CONTAINER_ROOT || norm.startsWith(`${CONTAINER_ROOT}/`)) {
    return { backendOutputDir: norm };
  }

  return {
    exportDir: norm,
    note: canExportToHost ? "exported" : "download",
  };
}
