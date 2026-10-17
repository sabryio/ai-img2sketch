import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { orpc } from "../rpc";
import type { EventData } from "../rpc/contract";
import type { QueryOverrides } from "./types";

/** Connection state of the event stream, as shown in the header badge. */
export type SseState = "connecting" | "online" | "reconnecting" | "closed";

type EventStreamOverrides = QueryOverrides<
  Parameters<typeof orpc.streamEvents.streamedOptions>[0]
>;

/** Reconnect delay after the stream drops (there is no server-side replay). */
const RECONNECT_INTERVAL_MS = 5_000;

/**
 * `GET /api/v1/events` — the live event stream.
 *
 * Mounting the hook opens the SSE connection; unmounting aborts it (TanStack
 * cancels the in-flight query), so a single call site owns the stream.
 *
 * `data` **accumulates every event of the session** (`streamedOptions`), in
 * arrival order. That is deliberate: a render can publish `sketch.started` and
 * `sketch.completed` within the same frame, and a "latest event only" view would
 * drop the first one on the floor — the notification log would silently lose
 * history. Consumers that want just the newest event read `data.at(-1)`.
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
 * Derive the header badge state from the stream query.
 *
 * Kept as a pure function so the mapping is unit-testable without a renderer.
 */
export function toSseState(
  result: Pick<UseQueryResult<readonly EventData[]>, "status" | "fetchStatus" | "data">,
  enabled: boolean,
): SseState {
  if (!enabled) {
    return "closed";
  }
  if (result.status === "error") {
    return "reconnecting";
  }
  if (result.data !== undefined) {
    return "online";
  }
  return result.fetchStatus === "fetching" ? "connecting" : "closed";
}
