/**
 * Tauri 2 plugin wrappers (dialog, shell, fs) with web-mode detection and graceful fallbacks.
 */

export function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface FilePickerOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  multiple?: boolean;
}

/**
 * Pick an image file from the host filesystem
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

      if (typeof selected === "string") return selected;
      return null;
    } catch (err) {
      console.warn("Tauri dialog failed, falling back to prompt/input", err);
    }
  }

  // Fallback for browser preview / development
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        // Return a mock host path or blob path for previewing
        resolve(`./media/${file.name}`);
      } else {
        resolve(null);
      }
    };
    input.click();
  });
}

/**
 * Pick a directory from the host filesystem
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

      if (typeof selected === "string") return selected;
      return null;
    } catch (err) {
      console.warn("Tauri directory dialog failed", err);
    }
  }

  // Fallback for browser preview
  const entered = window.prompt(
    "Enter folder path (e.g. ./media/batch_inputs):",
    "./media/batch_inputs",
  );
  return entered && entered.trim() ? entered.trim() : null;
}

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

  // In web environment: check if localhost:8000 is directly reachable or simulate
  return {
    running: true,
    details: "Web environment: assuming Docker or host port 8000 available",
  };
}

/**
 * Start Docker backend via `docker compose up -d`
 */
export async function startDockerComposeBackend(): Promise<{
  success: boolean;
  message: string;
}> {
  if (isTauriEnvironment()) {
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

  return {
    success: true,
    message: "Simulated docker compose up -d (Web preview)",
  };
}

/**
 * Stop Docker backend via `docker compose down`
 */
export async function stopDockerComposeBackend(): Promise<{
  success: boolean;
  message: string;
}> {
  if (isTauriEnvironment()) {
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

  return { success: true, message: "Simulated docker compose down" };
}

/**
 * Spawn sidecar executable `img2sketch-api`
 */
export async function spawnSidecarBackend(): Promise<{
  success: boolean;
  message: string;
}> {
  if (isTauriEnvironment()) {
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

  return { success: true, message: "Simulated sidecar launch (Web preview)" };
}

/**
 * Copy file from source to target on host using tauri-plugin-fs
 */
export async function copyHostFile(
  sourcePath: string,
  destinationPath: string,
): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { copyFile } = await import("@tauri-apps/plugin-fs");
      await copyFile(sourcePath, destinationPath);
      return true;
    } catch (err) {
      console.warn("tauri-plugin-fs copyFile failed", err);
      return false;
    }
  }
  return true;
}

/**
 * Convert file path to asset source URL for video tags
 */
export async function convertPathToAssetUrl(filePath: string): Promise<string> {
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
