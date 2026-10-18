/**
 * Reusable hooks over the typed oRPC contract (`src/rpc`). Each one wraps the
 * matching TanStack Query utility, so components never build URLs or cache keys
 * by hand.
 *
 * Hooks need the `QueryClientProvider` in `main.tsx`.
 */

export { useElapsed } from "./useElapsed";
export { useEventNotifications } from "./useEventNotifications";
export { useEventStream, toSseState } from "./useEventStream";
export type { SseSource, SseState } from "./useEventStream";
export { useGenerateBatch } from "./useGenerateBatch";
export { useGenerateSketch } from "./useGenerateSketch";
export { useHealth } from "./useHealth";
export { useLatestEvent } from "./useLatestEvent";
export type { QueryOverrides } from "./types";
