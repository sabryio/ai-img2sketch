import {
  COMMON_ERROR_STATUS_MAP,
  MalformedResponseError,
  ORPCError,
  type ORPCErrorCode,
} from "@orpc/client";
import { getApiOrigin } from "./apiOrigin";
import type { BackendMode } from "./paths";

/**
 * A request failure, flattened into what the UI actually renders.
 *
 * The FastAPI service answers errors with its own envelope
 * (`{"detail": "..."}` or FastAPI's validation list), which oRPC cannot decode
 * on its own — the link is configured with a decoder (see `rpc/index.ts`) so
 * failures arrive here as `ORPCError`s carrying that envelope as `data`.
 */
export interface AppError {
  /** HTTP status when the request reached the server. */
  status?: number;
  /** Sentence to show the user. */
  message: string;
  /** Untouched server text, for local debugging (shown for 5xx). */
  verbatim?: string;
  /** True when the path exists on the host but not where the backend looks. */
  isPathVisibilityError?: boolean;
}

const STATUS_TO_CODE = new Map<number, string>(
  Object.entries(COMMON_ERROR_STATUS_MAP).map(([code, status]) => [
    status,
    code,
  ]),
);

/** HTTP status for an oRPC error code (inverse of `COMMON_ERROR_STATUS_MAP`). */
export function statusForCode(code: string): number | undefined {
  return (COMMON_ERROR_STATUS_MAP as Record<string, number>)[code];
}

/** Best oRPC code for an HTTP status, used when decoding error bodies. */
export function codeForStatus(status: number): ORPCErrorCode {
  const known = STATUS_TO_CODE.get(status);
  if (known) {
    return known as ORPCErrorCode;
  }
  return status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
}

/** Sentence explaining where the backend is actually looking for files. */
function pathVisibilityMessage(mode: BackendMode): string {
  const advice =
    mode === "docker"
      ? "In Docker mode, files must be located in the mounted media directory (e.g. ./media) to be accessible to the container."
      : "In sidecar mode, verify that the local path exists and is readable by the sidecar process.";
  return `File or folder not visible to the backend. ${advice}`;
}

/**
 * Human-readable message from a FastAPI error body:
 * `{"detail": "Image not found: ..."}` or the validation list form
 * `{"detail": [{"loc": [...], "msg": "..."}]}`.
 */
export function fastApiDetail(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { loc?: (string | number)[]; msg?: string };
    if (typeof first?.msg === "string") {
      const location = (first.loc ?? [])
        .filter((part) => part !== "body")
        .join(".");
      return location ? `${location}: ${first.msg}` : first.msg;
    }
  }

  return undefined;
}

/** Serialize an error body for the "verbatim" debug panel. */
function verbatimFrom(body: unknown): string | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === "string") {
    return body;
  }
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

/** Map a status + server detail onto the message the UI shows. */
function fromStatus(
  status: number | undefined,
  detail: string | undefined,
  fallback: string,
  mode: BackendMode,
  verbatim: string | undefined,
): AppError {
  if (status === 404) {
    return {
      status,
      message: pathVisibilityMessage(mode),
      verbatim: verbatim ?? detail,
      isPathVisibilityError: true,
    };
  }

  if (status === 422) {
    return {
      status,
      message: detail ?? "Invalid request parameters (validation error).",
      verbatim: verbatim ?? detail,
    };
  }

  if (status !== undefined && status >= 500) {
    const text = detail ?? verbatim ?? fallback;
    return {
      status,
      message: `Backend processing error: ${text}`,
      verbatim: verbatim ?? detail,
    };
  }

  return { status, message: detail ?? fallback, verbatim: verbatim ?? detail };
}

/** Turn anything thrown by a call into a renderable {@link AppError}. */
export function toAppError(error: unknown, mode: BackendMode = "docker"): AppError {
  if (error instanceof ORPCError) {
    const status = statusForCode(error.code);
    const malformed = error.cause;
    const body =
      malformed instanceof MalformedResponseError
        ? malformed.response.body
        : error.data;

    return fromStatus(
      malformed instanceof MalformedResponseError
        ? malformed.response.status
        : status,
      fastApiDetail(body) ?? error.message,
      error.message,
      mode,
      verbatimFrom(body),
    );
  }

  if (error instanceof MalformedResponseError) {
    const body = error.response.body;
    return fromStatus(
      error.response.status,
      fastApiDetail(body) ?? error.message,
      error.message,
      mode,
      verbatimFrom(body),
    );
  }

  const detail = error instanceof Error ? error.message : String(error);
  return {
    message: `Cannot reach the backend at ${getApiOrigin()}: ${detail}`,
    verbatim: detail,
  };
}
