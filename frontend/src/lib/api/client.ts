import {
  AppError,
  BatchSketchRequest,
  BatchSketchResponse,
  FastAPIErrorPayload,
  FastAPIValidationErrorDetail,
  HealthResponse,
  SketchRequest,
  SketchResponse,
} from "./types";

// Default base URL from environment or fallback to standard localhost:8000
const DEFAULT_API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) ||
  "http://localhost:8000";

let currentApiBase = DEFAULT_API_BASE;

export function getApiBase(): string {
  return currentApiBase;
}

export function setApiBase(url: string): void {
  currentApiBase = url.replace(/\/+$/, "");
}

/**
 * Parses and formats FastAPI error responses into a typed AppError
 * conforming strictly to the error mapping rules:
 * - 404: "file/folder not visible to the backend" (mentioning active mode)
 * - 422: show the first detail message
 * - 500: show the verbatim message
 */
export async function parseApiError(
  response: Response,
  mode: "docker" | "sidecar" = "docker",
): Promise<AppError> {
  const status = response.status;
  let text = "";
  let json: FastAPIErrorPayload | null = null;

  try {
    text = await response.text();
    json = JSON.parse(text) as FastAPIErrorPayload;
  } catch {
    // text remains raw response string
  }

  // 404: File or folder visibility error
  if (status === 404) {
    const modeExplanation =
      mode === "docker"
        ? "In Docker mode, files must be located in the mounted media directory (e.g. ./media) to be accessible to the container."
        : "In sidecar mode, verify that the local path exists and is readable by the sidecar process.";

    const message = `File or folder not visible to the backend. ${modeExplanation}`;
    return {
      status: 404,
      message,
      verbatim: text || "404 Not Found",
      mode,
      isPathVisibilityError: true,
    };
  }

  // 422: Validation error - show first detail message
  if (status === 422) {
    let detailMessage = "Invalid request parameters (validation error).";
    if (json?.detail) {
      if (Array.isArray(json.detail) && json.detail.length > 0) {
        const first = json.detail[0] as FastAPIValidationErrorDetail;
        const loc = first.loc
          ? first.loc.filter((p) => p !== "body").join(".")
          : "";
        detailMessage = loc ? `${loc}: ${first.msg}` : first.msg;
      } else if (typeof json.detail === "string") {
        detailMessage = json.detail;
      }
    }
    return {
      status: 422,
      message: detailMessage,
      verbatim: text || "422 Unprocessable Entity",
      mode,
    };
  }

  // 500: Verbatim error message for local debugging
  if (status >= 500) {
    const verbatim =
      json?.message ||
      json?.detail ||
      json?.error ||
      text ||
      "Internal Server Error (500)";
    const verbatimStr =
      typeof verbatim === "string"
        ? verbatim
        : JSON.stringify(verbatim, null, 2);
    return {
      status: 500,
      message: `Backend processing error: ${verbatimStr}`,
      verbatim: verbatimStr,
      mode,
    };
  }

  // Generic fallback
  const genericMessage =
    json?.detail && typeof json.detail === "string"
      ? json.detail
      : json?.message || `HTTP ${status}: ${response.statusText}`;

  return {
    status,
    message: genericMessage,
    verbatim: text || response.statusText,
    mode,
  };
}

/**
 * Health check endpoint: GET /api/v1/health
 */
export async function checkHealth(
  customBaseUrl?: string,
): Promise<HealthResponse> {
  const base = customBaseUrl || getApiBase();
  const url = `${base}/api/v1/health`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw await parseApiError(res);
    }

    return (await res.json()) as HealthResponse;
  } catch (err: unknown) {
    if ((err as AppError).status) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw {
      status: 0,
      message: `Cannot reach backend at ${base}: ${msg}`,
      verbatim: msg,
    } as AppError;
  }
}

/**
 * Single sketch generation: POST /api/v1/sketches
 * Request is synchronous; may run seconds to minutes.
 */
export async function generateSketch(
  request: SketchRequest,
  mode: "docker" | "sidecar" = "docker",
  customBaseUrl?: string,
): Promise<SketchResponse> {
  const base = customBaseUrl || getApiBase();
  const url = `${base}/api/v1/sketches`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      throw await parseApiError(res, mode);
    }

    return (await res.json()) as SketchResponse;
  } catch (err: unknown) {
    if ((err as AppError).status) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw {
      status: 0,
      message: `Failed to communicate with backend: ${msg}`,
      verbatim: msg,
      mode,
    } as AppError;
  }
}

/**
 * Batch sketch generation: POST /api/v1/sketches/batch
 */
export async function generateBatchSketches(
  request: BatchSketchRequest,
  mode: "docker" | "sidecar" = "docker",
  customBaseUrl?: string,
): Promise<BatchSketchResponse> {
  const base = customBaseUrl || getApiBase();
  const url = `${base}/api/v1/sketches/batch`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      throw await parseApiError(res, mode);
    }

    return (await res.json()) as BatchSketchResponse;
  } catch (err: unknown) {
    if ((err as AppError).status) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw {
      status: 0,
      message: `Failed to communicate with backend during batch: ${msg}`,
      verbatim: msg,
      mode,
    } as AppError;
  }
}
