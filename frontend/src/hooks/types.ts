/**
 * Overrides a query hook may re-expose from its oRPC util.
 *
 * The data-shaping keys are deliberately **excluded**. A wrapper has to type its
 * parameter as `Parameters<typeof orpc.x.queryOptions>[0]`, and extracting that
 * instantiates the util's generics with their fallbacks (`USelectData = unknown`,
 * `UInitialData = unknown`). Passing those back through reopens `select` and
 * `initialData` as `unknown`, and TanStack infers `TData` from `select` — so the
 * hook would silently report `data: unknown` instead of the DTO.
 *
 * Callers that need `select`, `initialData`, a prebuilt `queryKey` or a custom
 * `input` should use `orpc.<procedure>.queryOptions(...)` directly.
 */
export type QueryOverrides<T> = Omit<
  NonNullable<T>,
  "select" | "initialData" | "input" | "queryKey" | "queryFn"
>;
