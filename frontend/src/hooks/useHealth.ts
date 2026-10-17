import { useQuery } from "@tanstack/react-query";
import { orpc } from "../rpc";
import type { QueryOverrides } from "./types";

type HealthOverrides = QueryOverrides<
  Parameters<typeof orpc.health.queryOptions>[0]
>;

/**
 * Backend liveness — `GET /api/v1/health`.
 *
 * Polls every 10 s so the startup gate and the header badge track the backend
 * without a manual refresh. Standard query options may be passed to override
 * the default (e.g. `{ refetchInterval: false }`).
 *
 * @example
 * const { data, isPending, error, refetch } = useHealth();
 * if (data) return <span>{data.status}</span>;
 */
export function useHealth(options?: HealthOverrides) {
  return useQuery(
    orpc.health.queryOptions({
      refetchInterval: 10_000,
      ...options,
    }),
  );
}
