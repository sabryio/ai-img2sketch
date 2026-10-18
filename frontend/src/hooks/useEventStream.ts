import { useQuery } from "@tanstack/react-query";
import { orpc } from "../rpc";
import type { QueryOverrides } from "./types";

/** Connection state of the event stream, as shown in the header badge. */
export type SseState = "connecting" | "online" | "reconnecting" | "closed";

type EventStreamOverrides = QueryOverrides<
  Parameters<typeof orpc.streamEvents.streamedOptions>[0]
>;

/**
 * The fields {@link toSseState} reads: exactly the `useQuery` destructuring, so
 * the mapping can be unit-tested without a renderer and against either stream
 * hook (`useLatestEvent` or `useEventStream`).
 */
export interface SseSource {
  /** Newest event (live query) or accumulated events (streamed query). */
  data: unknown;
  isLoading: boolean;
  error: unknown;
}

/** Reconnect delay after the stream drops (the server does not replay). */
const RECONNECT_INTERVAL_MS = 5_000;

/**
 * `GET /api/v1/events` — **every** event of the session, in arrival order.
 *
 * Mounting the hook opens the SSE connection; unmounting aborts it (TanStack
 * cancels the in-flight query), so a single call site owns the stream.
 *
 * `data` accumulates (`streamedOptions`), which is deliberate: a render can
 * publish two events close together, and a live query would keep only the last
 * one — the notification log would silently lose history and a failure toast
 * could be missed. Consumers that want just the newest event should use
 * `useLatestEvent`, which is a live query and cheaper to read from.
 *
 * If the connection drops, the query errors and `refetchInterval` reconnects
 * every {@link RECONNECT_INTERVAL_MS}; events published meanwhile are not
 * replayed (the bus is in-process).
 *
 * @example
 * const { data: events, isPending } = useEventStream();
 * const latest = events?.at(-1);
 * if (latest?.event === "sketch.completed") return latest.output_path;
 */
export function useEventStream(options?: EventStreamOverrides) {
  return useQuery(
    orpc.streamEvents.streamedOptions({
      retry: false,
      // Only meaningful in the error state: a healthy stream is a long-lived
      // fetch that never resolves, so this fires solely after a drop.
      refetchInterval: (query) =>
        query.state.status === "error" ? RECONNECT_INTERVAL_MS : false,
      ...options,
    }),
  );
}

/**
 * Derive the header badge state from a stream query.
 *
 * Kept as a pure function so the mapping is unit-testable without a renderer.
 *
 * "online" means an event has been received on this connection: the backend's
 * keep-alive comments are consumed by the oRPC client and never become data, so
 * a healthy but idle stream reads as "connecting". Events are not replayed, so
 * that is the only liveness signal the stream offers.
 */
export function toSseState(source: SseSource, enabled: boolean): SseState {
  if (!enabled) {
    return "closed";
  }
  if (source.error) {
    return "reconnecting";
  }
  if (source.data !== undefined) {
    return "online";
  }
  return source.isLoading ? "connecting" : "closed";
}
