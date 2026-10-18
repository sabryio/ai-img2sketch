/**
 * Tauri 2 plugin wrappers (dialog, shell, fs).
 *
 * Every wrapper degrades explicitly in a plain browser: the file pickers return
 * the picked `File` (a browser cannot name a host path), and process-level
 * actions report that they need the desktop shell. Nothing here pretends to
 * have succeeded — silently inventing a path (or a "docker compose up" that
 * never ran) only moves the failure downstream.
 */

import { IMAGE_ACCEPT } from "./media";

export function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** File-dialog filters matching what the backend's media store accepts. */
const IMAGE_FILTERS = [
  { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] },
  { name: "All Files", extensions: ["*"] },
];

export interface FilePickerOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

/** An image the user picked, in whichever form the host could give it. */
export interface PickedImage {
  /** Host path, when the desktop shell could provide one. */
  path: string | null;
  /** Browser-picked file, whose bytes have to be staged through the API. */
  file: File | null;
}

/** A folder of images the user picked. */
export interface PickedDirectory {
  /** Host directory, when the desktop shell could provide one. */
  path: string | null;
  /** Browser-picked files, whose bytes have to be staged through the API. */
  files: File[] | null;
}

interface FileInputOptions {
  accept?: string;
  multiple?: boolean;
  directory?: boolean;
}

/**
 * Open the platform's own file dialog from a browser.
 *
 * Resolves with the chosen files, or `null` when the dialog is dismissed — a
 * browser exposes no path, only the bytes, which is why the caller stages them.
 */
function openFileInput(options: FileInputOptions): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (options.accept) {
      input.accept = options.accept;
    }
    if (options.multiple) {
      input.multiple = true;
    }
    if (options.directory) {
      input.setAttribute("webkitdirectory", "");
    }
    input.style.display = "none";

    const finish = (files: File[] | null) => {
      input.remove();
      resolve(files);
    };

    input.addEventListener("change", () => {
      const files = input.files ? Array.from(input.files) : [];
      finish(files.length > 0 ? files : null);
    });
    // Chromium fires this when the dialog is dismissed; without it the promise
    // would never settle.
    input.addEventListener("cancel", () => finish(null));

    document.body.append(input);
    input.click();
  });
}

/** Show the shell's file dialog, or `null` if it failed or was cancelled. */
async function pickViaTauri(
  title: string,
  directory: boolean,
  filters?: Array<{ name: string; extensions: string[] }>,
): Promise<string | null> {
  if (!isTauriEnvironment()) {
    return null;
  }

  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      title,
      multiple: false,
      directory,
      filters,
    });
    return typeof selected === "string" ? selected : null;
  } catch (err) {
    console.warn("Tauri dialog failed", err);
    return null;
  }
}

/**
 * Pick an image file.
 *
 * The desktop shell returns a host path directly. A browser returns the picked
 * `File`, which the caller must stage through `POST /api/v1/media` before the
 * backend can read it.
 */
export async function pickImageFile(
  options?: FilePickerOptions,
): Promise<PickedImage | null> {
  const title = options?.title || "Select Image for Sketching";

  if (isTauriEnvironment()) {
    const path = await pickViaTauri(title, false, options?.filters || IMAGE_FILTERS);
    return path ? { path, file: null } : null;
  }

  const files = await openFileInput({ accept: IMAGE_ACCEPT, multiple: false });
  const file = files?.[0];
  return file ? { path: null, file } : null;
}

/**
 * Pick a folder of images.
 *
 * The desktop shell returns the directory path; a browser returns every file
 * inside it (there is no directory path to be had), for the caller to stage.
 */
export async function pickImageDirectory(
  title: string = "Select Input Directory of Images",
): Promise<PickedDirectory | null> {
  if (isTauriEnvironment()) {
    const path = await pickViaTauri(title, true);
    return path ? { path, files: null } : null;
  }

  const files = await openFileInput({
    accept: IMAGE_ACCEPT,
    multiple: true,
    directory: true,
  });
  return files ? { path: null, files } : null;
}

/**
 * Pick a directory the backend will *write* to.
 *
 * Desktop only: a browser cannot name a host folder the backend could write
 * into, so callers keep the field typeable and hide the button.
 */
export async function pickOutputDirectory(
  title: string = "Select Output Directory",
): Promise<string | null> {
  if (!isTauriEnvironment()) {
    return null;
  }

  return pickViaTauri(title, true);
}

/** Result of a lifecycle command, surfaced verbatim in the gate. */
export interface LifecycleResult {
  success: boolean;
  message: string;
}

/** Shown whenever a browser is asked to do something only the shell can do. */
const DESKTOP_ONLY = (what: string): LifecycleResult => ({
  success: false,
  message: `${what} requires the desktop app: a browser cannot run host processes.`,
});

/**
 * Probe whether Docker is running on the host system.
 * Returns true if `docker info` exits with code 0.
 */
export async function probeDockerDaemon(): Promise<{
  running: boolean;
  details?: string;
}> {
  if (isTauriEnvironment()) {
    try {
      const { Command } = await import("@tauri-apps/plugin-shell");
      const cmd = Command.create("docker", ["info"]);
      const output = await cmd.execute();
      return {
        running: output.code === 0,
        details:
          output.code === 0
            ? "Docker daemon is active"
            : output.stderr || "Docker daemon not responding",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        running: false,
        details: `Failed to execute docker probe: ${msg}`,
      };
    }
  }

  return {
    running: false,
    details: "Docker probing requires the desktop app (no shell in a browser).",
  };
}

/** Start the Docker backend via `docker compose up -d`. */
export async function startDockerComposeBackend(): Promise<LifecycleResult> {
  if (!isTauriEnvironment()) {
    return DESKTOP_ONLY("Starting the Docker backend");
  }

  try {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const cmd = Command.create("docker", ["compose", "up", "-d"]);
    const output = await cmd.execute();
    if (output.code === 0) {
      return {
        success: true,
        message: output.stdout || "Docker compose started",
      };
    }
    return {
      success: false,
      message:
        output.stderr || "docker compose up failed with non-zero exit code",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Docker execution error: ${msg}` };
  }
}

/** Stop the Docker backend via `docker compose down`. */
export async function stopDockerComposeBackend(): Promise<LifecycleResult> {
  if (!isTauriEnvironment()) {
    return DESKTOP_ONLY("Stopping the Docker backend");
  }

  try {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const cmd = Command.create("docker", ["compose", "down"]);
    const output = await cmd.execute();
    return {
      success: output.code === 0,
      message: output.code === 0 ? "Docker compose stopped" : output.stderr,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Docker stop error: ${msg}` };
  }
}

/** Spawn the sidecar executable `img2sketch-api`. */
export async function spawnSidecarBackend(): Promise<LifecycleResult> {
  if (!isTauriEnvironment()) {
    return DESKTOP_ONLY("Launching the sidecar");
  }

  try {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const cmd = Command.sidecar("img2sketch-api");
    const child = await cmd.spawn();
    return {
      success: true,
      message: `Sidecar spawned with PID: ${child.pid}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to spawn sidecar binary: ${msg}`,
    };
  }
}

/**
 * Copy a file on the host, used to stage Docker inputs into the mounted media
 * directory. Returns `false` in a browser, where the copy cannot happen.
 */
export async function copyHostFile(
  sourcePath: string,
  destinationPath: string,
): Promise<boolean> {
  if (!isTauriEnvironment()) {
    console.warn(
      `Cannot copy ${sourcePath} to ${destinationPath}: not running in the desktop app`,
    );
    return false;
  }

  try {
    const { copyFile } = await import("@tauri-apps/plugin-fs");
    await copyFile(sourcePath, destinationPath);
    return true;
  } catch (err) {
    console.error("tauri-plugin-fs copyFile failed", err);
    return false;
  }
}

/**
 * Convert a host file path into a URL a `<video>` element can load.
 *
 * In the desktop app that is the Tauri asset protocol; in a browser there is no
 * such protocol, so the path is returned unchanged and the player fails
 * visibly rather than pretending to have a URL.
 */
export async function convertPathToAssetUrl(filePath: string): Promise<string> {
  if (!filePath) {
    return "";
  }

  if (isTauriEnvironment()) {
    try {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      return convertFileSrc(filePath);
    } catch {
      return `asset://localhost/${filePath.replace(/\\/g, "/")}`;
    }
  }

  return filePath;
}
