/**
 * Reusable hooks over the typed oRPC contract (`src/rpc`). Each one wraps the
 * matching TanStack Query utility, so components never build URLs or keys by
 * hand.
 *
 * Hooks need the `QueryClientProvider` in `main.tsx`.
 */

export { useEventStream } from "./useEventStream";
export { useGenerateBatch } from "./useGenerateBatch";
export { useGenerateSketch } from "./useGenerateSketch";
export { useHealth } from "./useHealth";
