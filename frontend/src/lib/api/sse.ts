import { getApiBase } from "./client";
import { SSEEventMap, SSEEventName } from "./types";

export type SSEConnectionState =
  "connecting" | "online" | "reconnecting" | "closed";

type Listener<K extends SSEEventName> = (data: SSEEventMap[K]) => void;
type StateChangeListener = (state: SSEConnectionState) => void;

class SSEClient {
  private eventSource: EventSource | null = null;
  private state: SSEConnectionState = "closed";
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();
  private stateListeners: Set<StateChangeListener> = new Set();
  private beforeUnloadHandler: (() => void) | null = null;
  private isIntentionallyClosed = false;

  public getState(): SSEConnectionState {
    return this.state;
  }

  private setState(newState: SSEConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.stateListeners.forEach((listener) => {
        try {
          listener(newState);
        } catch (err) {
          console.error("Error in SSE state listener:", err);
        }
      });
    }
  }

  public onStateChange(listener: StateChangeListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public on<K extends SSEEventName>(
    event: K,
    handler: Listener<K>,
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    const genericHandler = handler as (data: unknown) => void;
    set.add(genericHandler);

    return () => {
      set.delete(genericHandler);
    };
  }

  private dispatchEvent<K extends SSEEventName>(
    event: K,
    rawData: string,
  ): void {
    try {
      const parsed = JSON.parse(rawData) as SSEEventMap[K];
      const handlers = this.listeners.get(event);
      if (handlers) {
        handlers.forEach((fn) => {
          try {
            fn(parsed);
          } catch (err) {
            console.error(`Error in SSE listener for "${event}":`, err);
          }
        });
      }
    } catch (parseErr) {
      console.warn(
        `Failed to parse SSE JSON for "${event}":`,
        parseErr,
        rawData,
      );
    }
  }

  /**
   * Connect to the SSE endpoint: GET /api/v1/events
   * Browser EventSource handles auto-reconnect via server's retry: 5000
   */
  public connect(
    customBaseUrl?: string,
    EventSourceClass: { new (url: string): EventSource } = window.EventSource,
  ): void {
    // If already connected and active, do nothing
    if (this.eventSource && this.state === "online") {
      return;
    }

    this.close();
    this.isIntentionallyClosed = false;
    this.setState("connecting");

    const base = customBaseUrl || getApiBase();
    const sseUrl = `${base}/api/v1/events`;

    try {
      const source = new EventSourceClass(sseUrl);
      this.eventSource = source;

      source.onopen = () => {
        this.setState("online");
      };

      source.onerror = () => {
        if (this.isIntentionallyClosed) {
          this.setState("closed");
          return;
        }

        // If the connection drops, EventSource automatically transitions to readyState CONNECTING (0)
        // and tries to reconnect after the server retry interval (5000ms).
        const isConnecting =
          typeof EventSource !== "undefined"
            ? source.readyState === EventSource.CONNECTING
            : source.readyState === 0;

        const isClosed =
          typeof EventSource !== "undefined"
            ? source.readyState === EventSource.CLOSED
            : source.readyState === 2;

        if (isConnecting) {
          this.setState("reconnecting");
        } else if (isClosed) {
          this.setState("closed");
        }
      };

      // Register named event listeners defined in docs/api.md
      const namedEvents: SSEEventName[] = [
        "sketch.started",
        "sketch.completed",
        "sketch.failed",
        "batch.started",
        "batch.completed",
        "batch.failed",
      ];

      namedEvents.forEach((eventName) => {
        source.addEventListener(eventName, (e: Event) => {
          const messageEvent = e as MessageEvent<string>;
          if (messageEvent.data) {
            this.dispatchEvent(eventName, messageEvent.data);
          }
        });
      });

      // Bind beforeunload to cleanly close connection
      if (typeof window !== "undefined" && !this.beforeUnloadHandler) {
        this.beforeUnloadHandler = () => {
          this.close();
        };
        window.addEventListener("beforeunload", this.beforeUnloadHandler);
      }
    } catch (err) {
      console.error("Failed to instantiate EventSource:", err);
      this.setState("closed");
    }
  }

  /**
   * Close the SSE connection
   */
  public close(): void {
    this.isIntentionallyClosed = true;
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch (err) {
        console.warn("Error closing EventSource:", err);
      }
      this.eventSource = null;
    }
    this.setState("closed");

    if (typeof window !== "undefined" && this.beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
  }
}

// Global SSE client instance
export const sseClient = new SSEClient();

export function initEventStream(baseUrl?: string): void {
  sseClient.connect(baseUrl);
}

export function closeEventStream(): void {
  sseClient.close();
}

export function addSSEListener<K extends SSEEventName>(
  event: K,
  handler: Listener<K>,
): () => void {
  return sseClient.on(event, handler);
}

export function onSSEStateChange(listener: StateChangeListener): () => void {
  return sseClient.onStateChange(listener);
}

export function getSSEState(): SSEConnectionState {
  return sseClient.getState();
}

// Export class for testing with mocks
export { SSEClient };
