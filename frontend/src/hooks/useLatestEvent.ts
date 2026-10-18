import { useQuery } from "@tanstack/react-query";
import { orpc } from "../rpc";
import type { QueryOverrides } from "./types";

type LatestEventOverrides = QueryOverrides<
  Parameters<typeof orpc.streamEvents.liveOptions>[0]
>;

/** Reconnect delay after the stream drops (the server does not replay). */
const RECONNECT_INTERVAL_MS = 5_000;

/**
 * The **newest** event on `GET /api/v1/events`.
 *
 * A live query, not a streamed one: every frame *replaces* the value instead of
 * accumulating into an array, so `data` is one event and `isLoading` / `error` /
 * `refetch` describe the connection itself.
 *
 * ```tsx
 * const { data: latest, isLoading, error, refetch } = useLatestEvent();
 * if (latest?.event === "sketch.completed") return latest.output_path;
 * ```
 *
 * Mounting this opens its own SSE connection; it is for consumers that only care
 * about "what just happened" (the header badge, a progress line). Anything that
 * needs the full history — the notification log, failure toasts — must use
 * `useEventStream`, because a live query keeps only the newest value:
 *
 * > Measured against a real render: when two app frames arrive in the same read
 * > (`sketch.started` and `sketch.completed` back to back, which the backend can
 * > produce), the live query observes only the last one — the intermediate event
 * > never reaches a render. `streamedOptions` keeps both.
 *
 * If the connection drops, the query errors and `refetchInterval` retries every
 * {@link RECONNECT_INTERVAL_MS}; events published while it was down are gone.
 */
export function useLatestEvent(options?: LatestEventOverrides) {
  return useQuery(
    orpc.streamEvents.liveOptions({
      retry: false,
      // Only meaningful in the error state: a healthy stream is a long-lived
      // fetch that never resolves, so this fires solely after a drop.
      refetchInterval: (query) =>
        query.state.status === "error" ? RECONNECT_INTERVAL_MS : false,
      ...options,
    }),
  );
}
