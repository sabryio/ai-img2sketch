import { create } from "zustand";
import { getApiOrigin, setApiOrigin } from "../lib/apiOrigin";
import {
  DEFAULT_PATH_CONFIG,
  type BackendMode,
  type PathConfig,
} from "../lib/paths";
import {
  isTauriEnvironment,
  probeDockerDaemon,
  spawnSidecarBackend,
  startDockerComposeBackend,
  stopDockerComposeBackend,
} from "../lib/tauri";

/**
 * Desktop/process concerns only: how the backend is reached (mode, volume
 * paths, origin) and the lifecycle commands that start it.
 *
 * It deliberately owns **no** network state — liveness lives in `useHealth`,
 * the event stream in `useEventStream` — so there is one source of truth for
 * everything the server tells us.
 */
interface BackendStore {
  mode: BackendMode;
  pathConfig: PathConfig;
  apiOrigin: string;

  dockerRunning: boolean;
  dockerProbeDetails: string | null;
  isCheckingDocker: boolean;

  isStartingBackend: boolean;
  backendActionLog: string | null;

  setMode: (mode: BackendMode) => void;
  setApiOrigin: (origin: string) => void;
  setPathConfig: (config: Partial<PathConfig>) => void;
  probeDocker: () => Promise<boolean>;
  startDocker: () => Promise<void>;
  stopDocker: () => Promise<void>;
  startSidecar: () => Promise<void>;
}

/**
 * Docker is the packaged way to run the service, but a browser (dev server or
 * Playwright) is always talking to a process on the same host, so the
 * pass-through mode is the correct default there.
 */
const DEFAULT_MODE: BackendMode = isTauriEnvironment() ? "docker" : "sidecar";

export const useBackendStore = create<BackendStore>((set, get) => ({
  mode: DEFAULT_MODE,
  pathConfig: DEFAULT_PATH_CONFIG,
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

  setPathConfig: (partial: Partial<PathConfig>) => {
    set((state) => ({
      pathConfig: { ...state.pathConfig, ...partial },
    }));
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
