import { create } from "zustand";
import { checkHealth, getApiBase, setApiBase } from "../lib/api/client";
import { initEventStream } from "../lib/api/sse";
import { DEFAULT_PATH_CONFIG, PathConfig } from "../lib/paths";
import {
  isTauriEnvironment,
  probeDockerDaemon,
  spawnSidecarBackend,
  startDockerComposeBackend,
  stopDockerComposeBackend,
} from "../lib/tauri";

export type BackendHealthState = "unknown" | "starting" | "ok" | "down";
export type BackendMode = "docker" | "sidecar";

interface BackendStore {
  // Connection and Health
  health: BackendHealthState;
  ready: boolean;
  pollCount: number;
  lastHealthCheckTime: number | null;
  lastHealthError: string | null;
  apiBase: string;
  isPollingActive: boolean;

  // Active Execution Mode & Paths
  mode: BackendMode;
  pathConfig: PathConfig;

  // Docker System Probe
  dockerRunning: boolean;
  dockerProbeDetails: string | null;
  isCheckingDocker: boolean;

  // Operations in flight
  isStartingBackend: boolean;
  backendActionLog: string | null;

  // Web Preview Simulator (for testing inside browser when native backend is not on port 8000)
  simulatorActive: boolean;

  // Actions
  setMode: (mode: BackendMode) => void;
  setApiBaseUrl: (url: string) => void;
  setPathConfig: (config: Partial<PathConfig>) => void;
  probeDocker: () => Promise<boolean>;
  checkHealthOnce: () => Promise<boolean>;
  startPollingHealth: () => void;
  stopPollingHealth: () => void;
  startDocker: () => Promise<void>;
  stopDocker: () => Promise<void>;
  startSidecar: () => Promise<void>;
  toggleSimulator: (active?: boolean) => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const useBackendStore = create<BackendStore>((set, get) => ({
  health: "starting",
  ready: false,
  pollCount: 0,
  lastHealthCheckTime: null,
  lastHealthError: null,
  apiBase: getApiBase(),
  isPollingActive: false,

  mode: "docker",
  pathConfig: DEFAULT_PATH_CONFIG,

  dockerRunning: false,
  dockerProbeDetails: null,
  isCheckingDocker: false,

  isStartingBackend: false,
  backendActionLog: null,

  simulatorActive: false,

  setMode: (mode: BackendMode) => {
    set({ mode });
  },

  setApiBaseUrl: (url: string) => {
    setApiBase(url);
    set({ apiBase: url });
    // Re-trigger health check with new base URL
    get().checkHealthOnce();
  },

  setPathConfig: (partial: Partial<PathConfig>) => {
    set((state) => ({
      pathConfig: { ...state.pathConfig, ...partial },
    }));
  },

  probeDocker: async () => {
    set({ isCheckingDocker: true });
    try {
      const res = await probeDockerDaemon();
      set({
        dockerRunning: res.running,
        dockerProbeDetails: res.details || null,
        isCheckingDocker: false,
      });
      return res.running;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        dockerRunning: false,
        dockerProbeDetails: msg,
        isCheckingDocker: false,
      });
      return false;
    }
  },

  checkHealthOnce: async () => {
    const { simulatorActive } = get();

    if (simulatorActive) {
      set({
        health: "ok",
        ready: true,
        lastHealthCheckTime: Date.now(),
        lastHealthError: null,
      });
      return true;
    }

    try {
      const res = await checkHealth();
      if (res.status === "ok" || res.status) {
        const wasReady = get().ready;
        set((state) => ({
          health: "ok",
          ready: true,
          pollCount: state.pollCount + 1,
          lastHealthCheckTime: Date.now(),
          lastHealthError: null,
        }));

        // Connect SSE stream on first health success
        if (!wasReady) {
          initEventStream();
        }
        return true;
      } else {
        set((state) => ({
          health: "down",
          ready: false,
          pollCount: state.pollCount + 1,
          lastHealthCheckTime: Date.now(),
          lastHealthError: `Unexpected status: ${res.status}`,
        }));
        return false;
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || String(err);
      set((state) => ({
        health: "down",
        ready: false,
        pollCount: state.pollCount + 1,
        lastHealthCheckTime: Date.now(),
        lastHealthError: msg,
      }));
      return false;
    }
  },

  startPollingHealth: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    set({ isPollingActive: true });
    // Run immediate check
    get().checkHealthOnce();
    get().probeDocker();

    // Poll every 2 seconds until healthy
    pollTimer = setInterval(async () => {
      const isOk = await get().checkHealthOnce();
      if (isOk) {
        // Once healthy, poll at a slower keepalive cadence (every 10s)
        if (pollTimer) {
          clearInterval(pollTimer);
        }
        pollTimer = setInterval(() => {
          get().checkHealthOnce();
        }, 10000);
      }
    }, 2000);
  },

  stopPollingHealth: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    set({ isPollingActive: false });
  },

  startDocker: async () => {
    set({
      isStartingBackend: true,
      backendActionLog: "Running: docker compose up -d ...",
    });
    try {
      const res = await startDockerComposeBackend();
      set({
        backendActionLog: res.message,
        isStartingBackend: false,
      });
      // Check health immediately and probe docker
      setTimeout(() => {
        get().probeDocker();
        get().checkHealthOnce();
      }, 1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        backendActionLog: `Failed to start Docker: ${msg}`,
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
      const res = await stopDockerComposeBackend();
      set({
        backendActionLog: res.message,
        isStartingBackend: false,
      });
      get().checkHealthOnce();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        backendActionLog: `Failed to stop Docker: ${msg}`,
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
      const res = await spawnSidecarBackend();
      set({
        backendActionLog: res.message,
        isStartingBackend: false,
        mode: "sidecar",
      });
      // Check health
      setTimeout(() => {
        get().checkHealthOnce();
      }, 1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        backendActionLog: `Failed to spawn sidecar: ${msg}`,
        isStartingBackend: false,
      });
    }
  },

  toggleSimulator: (active?: boolean) => {
    const next = active !== undefined ? active : !get().simulatorActive;
    set({
      simulatorActive: next,
      health: next ? "ok" : "starting",
      ready: next,
      lastHealthError: null,
      dockerRunning: next ? true : get().dockerRunning,
    });
    if (next) {
      initEventStream();
    }
  },
}));

// Auto-probe docker when Tauri environment is detected
if (isTauriEnvironment()) {
  probeDockerDaemon().then((res) => {
    useBackendStore.setState({
      dockerRunning: res.running,
      dockerProbeDetails: res.details || null,
    });
  });
}
