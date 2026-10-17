import { useQuery } from "@tanstack/react-query";
import { orpc } from "../rpc";
import type { QueryOverrides } from "./types";

type HealthOverrides = QueryOverrides<
  Parameters<typeof orpc.health.queryOptions>[0]
>;

/** Poll cadence while the backend is unreachable: the gate is on screen. */
const DOWN_POLL_MS = 2_000;

/** Poll cadence once the backend is up: just enough to notice it going away. */
const UP_POLL_MS = 10_000;

/**
 * Backend liveness — `GET /api/v1/health`.
 *
 * Polls itself, fast while the backend is down (so the gate clears as soon as
 * it comes up) and slowly while it is up. Standard query options may be passed
 * to override any of that.
 *
 * @example
 * const { data, status, error, refetch } = useHealth();
 * const ready = data?.status === "ok";
 */
export function useHealth(options?: HealthOverrides) {
  return useQuery(
    orpc.health.queryOptions({
      retry: false,
      refetchInterval: (query) =>
        query.state.status === "success" ? UP_POLL_MS : DOWN_POLL_MS,
      ...options,
    }),
  );
}
