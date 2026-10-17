import {
  createORPCClient,
  type FriendlyClientOptions,
  MalformedResponseError,
  onError,
  ORPCError,
} from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { RouterContractClient } from "@orpc/contract";
import { contract } from "./contract";

// ===== Client context =====

interface ClientContext {
  token?: string;
}

// ===== Link =====

const link = new OpenAPILink<ClientContext>(contract, {
  origin: import.meta.env.VITE_API_ORIGIN ?? "http://localhost:8000",
  url: "/",
  headers: ({ context }) => ({
    authorization: context?.token ? `Bearer ${context.token}` : undefined,
  }),
  interceptors: [
    onError((error) => {
      if (
        error instanceof ORPCError &&
        error.cause instanceof MalformedResponseError
      ) {
        console.error(
          "Malformed response:",
          error.cause.response.status,
          error.cause.response.body,
        );
      }
    }),
  ],
});

// ===== Client & query utils =====

export const client: RouterContractClient<typeof contract, ClientContext> =
  createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);

// ===== Event streaming =====

/**
 * Open `GET /api/v1/events` and return an async iterator of typed events.
 *
 * The endpoint is declared with `asyncIteratorObject` in the contract, so the
 * oRPC decoder owns the wire details: the initial-flush and periodic keep-alive
 * comments are skipped, every `data:` frame is validated against
 * `EventDataSchema`, and the terminal `event: close` frame ends the iteration.
 *
 * Events arrive as a discriminated union — narrow on `event.event`.
 *
 * @param options - oRPC call options. Pass `signal` to cancel the stream; this
 *   replaces the old `EventSource.close()`.
 *
 * @example
 * const controller = new AbortController();
 * const events = await streamEvents({ signal: controller.signal });
 *
 * for await (const event of events) {
 *   switch (event.event) {
 *     case "sketch.completed": console.log(event.output_path); break;
 *     case "sketch.failed":    console.error(event.error);     break;
 *     case "batch.completed":  console.log(event.succeeded);   break;
 *   }
 * }
 *
 * controller.abort();
 */
export function streamEvents(
  options?: FriendlyClientOptions<ClientContext>,
): ReturnType<typeof client.streamEvents> {
  return client.streamEvents(undefined, options);
}
