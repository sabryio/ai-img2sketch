import { useQuery } from "@tanstack/react-query";
import { orpc } from "../rpc";
import type { QueryOverrides } from "./types";

type EventStreamOverrides = QueryOverrides<
  Parameters<typeof orpc.streamEvents.liveOptions>[0]
>;

/**
 * Live view of `GET /api/v1/events`.
 *
 * `data` is the **most recent** event on the stream: the endpoint is declared
 * as an `asyncIteratorObject`, and `liveOptions` replaces the result with every
 * new chunk (unlike `streamedOptions`, which accumulates all chunks into an
 * array). The SSE connection lives while this hook is mounted and is aborted on
 * unmount, so mounting it is what opens the stream.
 *
 * Events are a discriminated union — narrow on `data.event`.
 *
 * @example
 * const { data: event, isPending } = useEventStream();
 * if (event?.event === "sketch.completed") return event.output_path;
 * if (event?.event === "batch.completed")  return `${event.succeeded} done`;
 */
export function useEventStream(options?: EventStreamOverrides) {
  return useQuery(orpc.streamEvents.liveOptions({ ...options }));
}
