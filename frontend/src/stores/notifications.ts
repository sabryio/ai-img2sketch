import { create } from "zustand";
import type { EventData } from "../rpc/contract";

export interface ToastItem {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  /** Untouched server text for the "copy verbatim" action. */
  verbatim?: string;
  timestamp: number;
}

export interface EventLogItem {
  id: string;
  name: EventData["event"];
  timestamp: number;
  data: EventData;
}

/** Oldest history entries are dropped past this many. */
const MAX_EVENTS = 50;

/** Newest toasts are kept; the cap keeps the stack readable. */
const MAX_TOASTS = 5;

/** Auto-dismiss delay for everything except errors (which the user may copy). */
const AUTO_DISMISS_MS = 6000;

/** Window in which a repeated message is treated as the same notification. */
const DUPLICATE_WINDOW_MS = 5000;

/**
 * Cross-cutting notifications: toasts (raised by mutations and by failures on
 * the event stream) and a rolling log of every event the backend published.
 *
 * Both `sketch.failed` and the rejected POST describe the same failure, so
 * `addToast` folds a repeat within {@link DUPLICATE_WINDOW_MS} into the toast
 * that is already on screen — the user sees the error once.
 */
interface NotificationsStore {
  toasts: ToastItem[];
  events: EventLogItem[];

  addToast: (toast: Omit<ToastItem, "id" | "timestamp">) => void;
  dismissToast: (id: string) => void;
  /** Record one event from the stream; safe to call with repeats. */
  ingest: (event: EventData) => void;
  clearEvents: () => void;
}

/**
 * Events are identities, not values: the stream may hand the same array to
 * several renders (and to a freshly mounted consumer), and each event must
 * produce exactly one log entry and at most one toast. A `WeakSet` keyed by the
 * payload object dedupes by identity without retaining anything.
 */
const ingested = new WeakSet<EventData>();

function isDuplicateToast(toasts: ToastItem[], next: ToastItem): boolean {
  const now = next.timestamp;
  return toasts.some((toast) => {
    if (toast.type !== next.type || now - toast.timestamp > DUPLICATE_WINDOW_MS) {
      return false;
    }
    const a = toast.message;
    const b = next.message;
    return a === b || a.includes(b) || b.includes(a);
  });
}

function toastForEvent(
  event: EventData,
): Omit<ToastItem, "id" | "timestamp"> | null {
  switch (event.event) {
    case "sketch.failed":
      return {
        type: "error",
        title: "Sketch Failed",
        message: event.error || `Processing failed for ${event.image}`,
        verbatim: event.error || undefined,
      };
    case "batch.failed":
      return {
        type: "error",
        title: "Batch Failed",
        message: event.error || `Batch failed for directory ${event.input_dir}`,
        verbatim: event.error || undefined,
      };
    default:
      return null;
  }
}

export const useNotificationsStore = create<NotificationsStore>((set, get) => ({
  toasts: [],
  events: [],

  addToast: (toast) => {
    const next: ToastItem = {
      ...toast,
      id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };

    if (isDuplicateToast(get().toasts, next)) {
      return;
    }

    set((state) => ({ toasts: [...state.toasts, next].slice(-MAX_TOASTS) }));

    if (next.type !== "error") {
      setTimeout(() => get().dismissToast(next.id), AUTO_DISMISS_MS);
    }
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  ingest: (event) => {
    if (ingested.has(event)) {
      return;
    }
    ingested.add(event);

    const item: EventLogItem = {
      id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: event.event,
      timestamp: Date.now(),
      data: event,
    };
    set((state) => ({ events: [item, ...state.events].slice(0, MAX_EVENTS) }));

    const toast = toastForEvent(event);
    if (toast) {
      get().addToast(toast);
    }
  },

  clearEvents: () => {
    set({ events: [] });
  },
}));
