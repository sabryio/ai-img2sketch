import { QueryClient } from "@tanstack/react-query";

/**
 * The single QueryClient for the app, provided in `main.tsx`.
 *
 * Defaults are tuned for a local, single-user backend:
 * - `retry: false` — an unreachable backend must surface immediately; the
 *   startup gate owns reconnection and every mutation is user-initiated.
 * - `refetchOnWindowFocus: false` — the Tauri webview fires focus constantly.
 * - `staleTime` — state changes are pushed on the event stream, so a resolved
 *   query does not need to be refetched the instant a component remounts.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
    mutations: {
      retry: false,
    },
  },
});
