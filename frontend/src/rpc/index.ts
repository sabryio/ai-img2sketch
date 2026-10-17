import {
  createORPCClient,
  type FriendlyClientOptions,
  MalformedResponseError,
  onError,
  ORPCError,
} from "@orpc/client";
import type { RouterContractClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { getApiOrigin } from "../lib/apiOrigin";
import { codeForStatus, fastApiDetail } from "../lib/errors";
import { contract } from "./contract";

// ===== Client context =====

interface ClientContext {
  token?: string;
}

// ===== Link =====

const link = new OpenAPILink<ClientContext>(contract, {
  /**
   * Read per request rather than captured once, so the Settings modal can
   * repoint the app at another backend (a container on a different port, a
   * remote host) without a reload.
   */
  origin: () => getApiOrigin(),
  url: "/",
  headers: ({ context }) => ({
    authorization: context?.token ? `Bearer ${context.token}` : undefined,
  }),

  /**
   * The service answers errors with FastAPI's envelope — `{"detail": "..."}`
   * or the validation list — which oRPC cannot decode: every 404/422/500 would
   * surface as a bare `MalformedResponseError` with the detail dropped, and the
   * `.errors({...})` declared on the contract would never match.
   *
   * Re-shape it into a typed `ORPCError` carrying the envelope as `data`, so
   * both the call sites and `toAppError` see the real status and message.
   */
  customErrorResponseBodyDecoder: (body, response) => {
    const detail = fastApiDetail(body);
    if (!detail) {
      // No recognizable detail (e.g. a proxy HTML page): fall through to oRPC's
      // default handling, which `toAppError` still understands.
      return undefined;
    }
    return new ORPCError(codeForStatus(response.status), {
      message: detail,
      data: body,
    });
  },

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

/**
 * TanStack Query utilities for every procedure in the contract.
 *
 * Components should not build URLs, keys or `fetch` calls: use the hooks in
 * `src/hooks`, which wrap these (`useQuery(orpc.health.queryOptions())`).
 */
export const orpc = createTanstackQueryUtils(client);

export type { ClientContext, FriendlyClientOptions };
