/**
 * Tauri 2 plugin wrappers (dialog, shell, fs).
 *
 * Every wrapper degrades explicitly in a plain browser: dialogs ask for a path
 * instead of fabricating one, and process-level actions report that they need
 * the desktop shell. Nothing here pretends to have succeeded — a browser cannot
 * reach the host filesystem, and silently inventing a path (or a "docker
 * compose up" that never ran) only moves the failure downstream.
 */

export function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface FilePickerOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  multiple?: boolean;
}

/** Ask the user for a path in a browser, where no native picker exists. */
function promptForPath(title: string, hint: string): string | null {
  const entered = window.prompt(title, hint);
  return entered && entered.trim() ? entered.trim() : null;
}

/**
 * Pick an image file from the host filesystem.
 *
 * Returns `null` when nothing is chosen — including in a browser, which has no
 * way to turn a `<input type="file">` selection into a path the backend can
 * open.
 */
export async function openImageFileDialog(
  options?: FilePickerOptions,
): Promise<string | null> {
  if (isTauriEnvironment()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: options?.title || "Select Image for Sketching",
        multiple: false,
        directory: false,
        filters: options?.filters || [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      return typeof selected === "string" ? selected : null;
    } catch (err) {
      console.warn("Tauri image dialog failed", err);
      return null;
    }
  }

  return promptForPath(
    options?.title || "Enter the image path the backend can read",
    "./media/image.png",
  );
}

/**
 * Pick a directory from the host filesystem.
 */
export async function openDirectoryDialog(
  title: string = "Select Directory",
): Promise<string | null> {
  if (isTauriEnvironment()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title,
        multiple: false,
        directory: true,
      });

      return typeof selected === "string" ? selected : null;
    } catch (err) {
      console.warn("Tauri directory dialog failed", err);
      return null;
    }
  }

  return promptForPath(title, "./media/batch_inputs");
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
