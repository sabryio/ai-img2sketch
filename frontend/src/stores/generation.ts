import { create } from "zustand";
import { generateBatchSketches, generateSketch } from "../lib/api/client";
import {
  addSSEListener,
  getSSEState,
  onSSEStateChange,
  SSEConnectionState,
} from "../lib/api/sse";
import {
  AppError,
  BatchCompletedEvent,
  BatchFailedEvent,
  BatchItemResult,
  BatchSketchRequest,
  BatchSketchResponse,
  BatchStartedEvent,
  SketchCompletedEvent,
  SketchFailedEvent,
  SketchRequest,
  SketchResponse,
  SketchStartedEvent,
} from "../lib/api/types";
import { mapBackendPathToHost, mapHostPathToBackend } from "../lib/paths";
import { copyHostFile } from "../lib/tauri";
import { useBackendStore } from "./backend";

export interface ToastItem {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  verbatim?: string;
  timestamp: number;
}

export interface GenerationEventLog {
  id: string;
  type: string;
  timestamp: number;
  data: unknown;
}

interface GenerationStore {
  // Single generation state
  inFlightSingle: boolean;
  singleElapsedSec: number;
  singleResult: SketchResponse | null;
  lastSingleRequest: SketchRequest | null;
  singleResolvedHostPath: string | null;

  // Batch generation state
  inFlightBatch: boolean;
  batchElapsedSec: number;
  batchResult: BatchSketchResponse | null;
  batchSummary: { succeeded: number; failed: number; total: number } | null;
  lastBatchRequest: BatchSketchRequest | null;

  // Error & Toasts
  lastError: AppError | null;
  toasts: ToastItem[];

  // SSE State & History
  sseState: SSEConnectionState;
  eventsHistory: GenerationEventLog[];

  // Actions
  executeSingleGeneration: (
    request: SketchRequest,
  ) => Promise<SketchResponse | null>;
  executeBatchGeneration: (
    request: BatchSketchRequest,
  ) => Promise<BatchSketchResponse | null>;
  addToast: (toast: Omit<ToastItem, "id" | "timestamp">) => void;
  dismissToast: (id: string) => void;
  clearLastError: () => void;
  resetSingleResult: () => void;
  resetBatchResult: () => void;
}

let singleTimer: ReturnType<typeof setInterval> | null = null;
let batchTimer: ReturnType<typeof setInterval> | null = null;

// Track active request timestamps to deduplicate SSE failure events
let lastHandledErrorMsg: string | null = null;
let lastHandledErrorTime = 0;

export const useGenerationStore = create<GenerationStore>((set, get) => ({
  inFlightSingle: false,
  singleElapsedSec: 0,
  singleResult: null,
  lastSingleRequest: null,
  singleResolvedHostPath: null,

  inFlightBatch: false,
  batchElapsedSec: 0,
  batchResult: null,
  batchSummary: null,
  lastBatchRequest: null,

  lastError: null,
  toasts: [],

  sseState: getSSEState(),
  eventsHistory: [],

  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newToast: ToastItem = {
      ...toast,
      id,
      timestamp: Date.now(),
    };

    set((state) => ({
      toasts: [...state.toasts.slice(-4), newToast],
    }));

    // Auto dismiss info & success after 6 seconds; errors stay for user inspection
    if (toast.type !== "error") {
      setTimeout(() => {
        get().dismissToast(id);
      }, 6000);
    }
  },

  dismissToast: (id: string) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearLastError: () => {
    set({ lastError: null });
  },

  resetSingleResult: () => {
    set({ singleResult: null, singleResolvedHostPath: null });
  },

  resetBatchResult: () => {
    set({ batchResult: null, batchSummary: null });
  },

  executeSingleGeneration: async (req: SketchRequest) => {
    const { mode, pathConfig, simulatorActive } = useBackendStore.getState();

    // Map input file paths according to mode rules
    let effectiveImagePath = req.image_path;

    if (mode === "docker") {
      const mapped = mapHostPathToBackend(req.image_path, "docker", pathConfig);
      effectiveImagePath = mapped.backendPath;

      if (mapped.needsCopy && mapped.destinationHostPath) {
        // Attempt copy to media folder
        await copyHostFile(req.image_path, mapped.destinationHostPath);
      }
    }

    const payload: SketchRequest = {
      ...req,
      image_path: effectiveImagePath,
    };

    // Start timer and set inFlight
    if (singleTimer) clearInterval(singleTimer);
    set({
      inFlightSingle: true,
      singleElapsedSec: 0,
      lastSingleRequest: payload,
      singleResult: null,
      singleResolvedHostPath: null,
      lastError: null,
    });

    singleTimer = setInterval(() => {
      set((s) => ({ singleElapsedSec: s.singleElapsedSec + 1 }));
    }, 1000);

    try {
      let result: SketchResponse;

      if (simulatorActive) {
        // Web simulator mode for preview testing
        await new Promise((r) => setTimeout(r, 2500));
        result = {
          output_path:
            mode === "docker"
              ? "/app/output/sketch_demo.mp4"
              : "./output/sketch_demo.mp4",
          duration_sec: 4.8,
          frame_count: 120,
          status: "completed",
        };
      } else {
        result = await generateSketch(payload, mode);
      }

      if (singleTimer) {
        clearInterval(singleTimer);
        singleTimer = null;
      }

      // Map backend output path back to host
      const hostPath = mapBackendPathToHost(
        result.output_path,
        mode,
        pathConfig,
      );

      set({
        inFlightSingle: false,
        singleResult: result,
        singleResolvedHostPath: hostPath,
      });

      get().addToast({
        type: "success",
        title: "Sketch Video Generated",
        message: `Video saved to ${hostPath}`,
      });

      return result;
    } catch (err: unknown) {
      if (singleTimer) {
        clearInterval(singleTimer);
        singleTimer = null;
      }

      const appError = err as AppError;
      set({
        inFlightSingle: false,
        lastError: appError,
      });

      // Deduplication marker
      lastHandledErrorMsg = appError.message;
      lastHandledErrorTime = Date.now();

      get().addToast({
        type: "error",
        title: appError.status
          ? `Error (${appError.status})`
          : "Generation Failed",
        message: appError.message,
        verbatim: appError.verbatim,
      });

      return null;
    }
  },

  executeBatchGeneration: async (req: BatchSketchRequest) => {
    const { mode, pathConfig, simulatorActive } = useBackendStore.getState();

    let effectiveInputDir = req.input_dir;
    if (mode === "docker") {
      const mapped = mapHostPathToBackend(req.input_dir, "docker", pathConfig);
      effectiveInputDir = mapped.backendPath;
    }

    const payload: BatchSketchRequest = {
      ...req,
      input_dir: effectiveInputDir,
    };

    if (batchTimer) clearInterval(batchTimer);
    set({
      inFlightBatch: true,
      batchElapsedSec: 0,
      lastBatchRequest: payload,
      batchResult: null,
      batchSummary: null,
      lastError: null,
    });

    batchTimer = setInterval(() => {
      set((s) => ({ batchElapsedSec: s.batchElapsedSec + 1 }));
    }, 1000);

    try {
      let result: BatchSketchResponse;

      if (simulatorActive) {
        // Web simulator mode
        await new Promise((r) => setTimeout(r, 3200));
        const items: BatchItemResult[] = [
          {
            image: "sample_portrait.png",
            output_path:
              mode === "docker"
                ? "/app/output/sample_portrait_sketch.mp4"
                : "./output/sample_portrait_sketch.mp4",
          },
          {
            image: "architecture_sketch.jpg",
            output_path:
              mode === "docker"
                ? "/app/output/architecture_sketch.mp4"
                : "./output/architecture_sketch.mp4",
          },
          {
            image: "corrupt_sample.png",
            output_path: null,
            error: "Corrupt image header (truncated PNG stream)",
          },
        ];
        result = {
          items,
          total: 3,
          succeeded: 2,
          failed: 1,
          input_dir: payload.input_dir,
        };
      } else {
        result = await generateBatchSketches(payload, mode);
      }

      if (batchTimer) {
        clearInterval(batchTimer);
        batchTimer = null;
      }

      // Map output paths
      const mappedItems = (result.items || []).map((item) => ({
        ...item,
        output_path: item.output_path
          ? mapBackendPathToHost(item.output_path, mode, pathConfig)
          : null,
      }));

      const succeeded =
        result.succeeded ??
        mappedItems.filter((i) => !i.error && i.output_path).length;
      const failed = result.failed ?? mappedItems.filter((i) => i.error).length;
      const total = result.total ?? mappedItems.length;

      set({
        inFlightBatch: false,
        batchResult: {
          ...result,
          items: mappedItems,
        },
        batchSummary: { succeeded, failed, total },
      });

      get().addToast({
        type: failed > 0 ? "warning" : "success",
        title: "Batch Completed",
        message: `Processed ${total} files: ${succeeded} succeeded, ${failed} failed.`,
      });

      return result;
    } catch (err: unknown) {
      if (batchTimer) {
        clearInterval(batchTimer);
        batchTimer = null;
      }

      const appError = err as AppError;
      set({
        inFlightBatch: false,
        lastError: appError,
      });

      lastHandledErrorMsg = appError.message;
      lastHandledErrorTime = Date.now();

      get().addToast({
        type: "error",
        title: appError.status
          ? `Batch Error (${appError.status})`
          : "Batch Generation Failed",
        message: appError.message,
        verbatim: appError.verbatim,
      });

      return null;
    }
  },
}));

// Wire SSE events to update the store and create non-duplicate ambient notifications
onSSEStateChange((state) => {
  useGenerationStore.setState({ sseState: state });
});

function recordEvent(type: string, data: unknown) {
  const item: GenerationEventLog = {
    id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    timestamp: Date.now(),
    data,
  };
  useGenerationStore.setState((s) => ({
    eventsHistory: [item, ...s.eventsHistory].slice(0, 50),
  }));
}

// Named SSE event listeners
addSSEListener("sketch.started", (event: SketchStartedEvent) => {
  recordEvent("sketch.started", event);
});

addSSEListener("sketch.completed", (event: SketchCompletedEvent) => {
  recordEvent("sketch.completed", event);
});

addSSEListener("sketch.failed", (event: SketchFailedEvent) => {
  recordEvent("sketch.failed", event);

  // Deduplicate against already-shown request errors
  const now = Date.now();
  if (
    lastHandledErrorMsg &&
    lastHandledErrorMsg.includes(event.error) &&
    now - lastHandledErrorTime < 4000
  ) {
    return;
  }

  useGenerationStore.getState().addToast({
    type: "error",
    title: "Sketch Failed (SSE)",
    message: event.error || `Processing failed for ${event.image_path}`,
  });
});

addSSEListener("batch.started", (event: BatchStartedEvent) => {
  recordEvent("batch.started", event);
});

addSSEListener("batch.completed", (event: BatchCompletedEvent) => {
  recordEvent("batch.completed", event);
  useGenerationStore.setState({
    batchSummary: {
      succeeded: event.succeeded,
      failed: event.failed,
      total: event.total,
    },
  });
});

addSSEListener("batch.failed", (event: BatchFailedEvent) => {
  recordEvent("batch.failed", event);

  const now = Date.now();
  if (
    lastHandledErrorMsg &&
    lastHandledErrorMsg.includes(event.error) &&
    now - lastHandledErrorTime < 4000
  ) {
    return;
  }

  useGenerationStore.getState().addToast({
    type: "error",
    title: "Batch Failed (SSE)",
    message: event.error || `Batch failed for directory ${event.input_dir}`,
  });
});
