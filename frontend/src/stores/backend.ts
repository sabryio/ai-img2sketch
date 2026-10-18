import { create } from "zustand";
import { getApiOrigin, setApiOrigin } from "../lib/apiOrigin";
import type { BackendMode } from "../lib/paths";
import {
  isTauriEnvironment,
  probeDockerDaemon,
  spawnSidecarBackend,
  startDockerComposeBackend,
  stopDockerComposeBackend,
} from "../lib/tauri";

/**
 * Desktop/process concerns only: how the backend is reached (mode, origin) and
 * the lifecycle commands that start it.
 *
 * It deliberately owns **no** network state — liveness lives in `useHealth`,
 * the event stream in `useEventStream` — so there is one source of truth for
 * everything the server tells us.
 */
interface BackendStore {
  mode: BackendMode;
  apiOrigin: string;

  dockerRunning: boolean;
  dockerProbeDetails: string | null;
  isCheckingDocker: boolean;

  isStartingBackend: boolean;
  backendActionLog: string | null;

  setMode: (mode: BackendMode) => void;
  setApiOrigin: (origin: string) => void;
  probeDocker: () => Promise<boolean>;
  startDocker: () => Promise<void>;
  stopDocker: () => Promise<void>;
  startSidecar: () => Promise<void>;
}

/**
 * Docker is how the service ships: one image, and the only files it can read are
 * the ones a client uploaded to it. The desktop build and a browser (dev server
 * or Playwright) therefore both start in Docker mode; the native sidecar stays
 * one click away in Settings for people running the `img2sketch-api` binary
 * directly.
 */
const DEFAULT_MODE: BackendMode = "docker";

export const useBackendStore = create<BackendStore>((set, get) => ({
  mode: DEFAULT_MODE,
  apiOrigin: getApiOrigin(),

  dockerRunning: false,
  dockerProbeDetails: null,
  isCheckingDocker: false,

  isStartingBackend: false,
  backendActionLog: null,

  setMode: (mode: BackendMode) => {
    set({ mode });
  },

  setApiOrigin: (origin: string) => {
    set({ apiOrigin: setApiOrigin(origin) });
  },

  probeDocker: async () => {
    set({ isCheckingDocker: true });
    try {
      const result = await probeDockerDaemon();
      set({
        dockerRunning: result.running,
        dockerProbeDetails: result.details || null,
        isCheckingDocker: false,
      });
      return result.running;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        dockerRunning: false,
        dockerProbeDetails: message,
        isCheckingDocker: false,
      });
      return false;
    }
  },

  startDocker: async () => {
    set({
      isStartingBackend: true,
      backendActionLog: "Running: docker compose up -d ...",
    });
    try {
      const result = await startDockerComposeBackend();
      set({ backendActionLog: result.message, isStartingBackend: false });
      get().probeDocker();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        backendActionLog: `Failed to start Docker: ${message}`,
        isStartingBackend: false,
      });
    }
  },

  stopDocker: async () => {
    set({
      isStartingBackend: true,
      backendActionLog: "Running: docker compose down ...",
    });
    try {
      const result = await stopDockerComposeBackend();
      set({ backendActionLog: result.message, isStartingBackend: false });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        backendActionLog: `Failed to stop Docker: ${message}`,
        isStartingBackend: false,
      });
    }
  },

  startSidecar: async () => {
    set({
      isStartingBackend: true,
      backendActionLog: "Spawning sidecar: img2sketch-api ...",
    });
    try {
      const result = await spawnSidecarBackend();
      set({
        backendActionLog: result.message,
        isStartingBackend: false,
        mode: "sidecar",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        backendActionLog: `Failed to spawn sidecar: ${message}`,
        isStartingBackend: false,
      });
    }
  },
}));

// Probe the daemon once at startup so the gate can report its status without
// waiting for a click (Tauri only; the browser cannot run `docker info`).
if (isTauriEnvironment()) {
  probeDockerDaemon().then((result) => {
    useBackendStore.setState({
      dockerRunning: result.running,
      dockerProbeDetails: result.details || null,
    });
  });
}
