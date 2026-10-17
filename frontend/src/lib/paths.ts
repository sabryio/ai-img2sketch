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
 */
export function mapHostPathToBackend(
  hostPath: string,
  mode: "docker" | "sidecar",
  config: PathConfig = DEFAULT_PATH_CONFIG,
): { backendPath: string; needsCopy: boolean; destinationHostPath?: string } {
  const norm = normalizePath(hostPath.trim());
  if (!norm) {
    return { backendPath: "", needsCopy: false };
  }

  if (mode === "sidecar") {
    return { backendPath: norm, needsCopy: false };
  }

  // Docker mode
  const filename = getBasename(norm);
  const hostMediaDir = `${config.projectRoot}/${config.mediaSubdir}`.replace(
    "//",
    "/",
  );
  const targetHostPath = `${hostMediaDir}/${filename}`.replace("//", "/");

  // If already pointing inside /app/media or the relative media directory
  if (norm.startsWith("/app/media/")) {
    return { backendPath: norm, needsCopy: false };
  }

  const backendPath = `/app/media/${filename}`;
  const needsCopy = norm !== targetHostPath;

  return {
    backendPath,
    needsCopy,
    destinationHostPath: targetHostPath,
  };
}

/**
 * Converts an output path returned by the backend back to the host filesystem path.
 */
export function mapBackendPathToHost(
  backendPath: string,
  mode: "docker" | "sidecar",
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
    const hostOutputDir =
      `${config.projectRoot}/${config.outputSubdir}`.replace("//", "/");
    return `${hostOutputDir}/${rel}`.replace("//", "/");
  }

  if (norm.startsWith("/app/media/")) {
    const rel = norm.replace("/app/media/", "");
    const hostMediaDir = `${config.projectRoot}/${config.mediaSubdir}`.replace(
      "//",
      "/",
    );
    return `${hostMediaDir}/${rel}`.replace("//", "/");
  }

  return norm;
}

/**
 * Converts a local file path to a URL that can be loaded in an HTML5 video player inside Tauri
 * or falls back cleanly in web mode.
 */
export function toMediaAssetUrl(filePath: string): string {
  if (!filePath) return "";

  // If it's already an http or data or blob URL
  if (
    filePath.startsWith("http://") ||
    filePath.startsWith("https://") ||
    filePath.startsWith("data:") ||
    filePath.startsWith("blob:")
  ) {
    return filePath;
  }

  // In Tauri 2: the asset protocol is registered as asset:// or via convertFileSrc
  const norm = normalizePath(filePath);
  // If running in browser where asset:// is unavailable, return as-is
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    // Windows vs POSIX asset URL format
    if (/^[A-Za-z]:/.test(norm)) {
      return `asset://localhost/${norm}`;
    }
    return `asset://localhost${norm.startsWith("/") ? "" : "/"}${norm}`;
  }

  return norm;
}
