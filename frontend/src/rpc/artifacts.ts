import { ORPCError } from "@orpc/client";
import { getApiOrigin } from "../lib/apiOrigin";
import { codeForStatus, fastApiDetail } from "../lib/errors";

/**
 * Files the backend holds: fetch one, or drop one.
 *
 * Every other call travels through the oRPC contract as JSON. These two cannot:
 * the download response body *is* the video, and the delete has no body at all.
 * So this module owns the only URLs the app builds by hand, and reports failures
 * as the same `ORPCError` the contract raises — so `toAppError` renders them
 * identically.
 */

/** `GET /api/v1/artifacts/download` for one path the backend reported. */
export function artifactDownloadUrl(
  backendPath: string,
  disposition: "attachment" | "inline" = "attachment",
): string {
  const origin = getApiOrigin().replace(/\/+$/, "");
  const query = new URLSearchParams({ path: backendPath, disposition });
  return `${origin}/api/v1/artifacts/download?${query.toString()}`;
}

/** `DELETE /api/v1/artifacts` for one path the backend reported. */
function artifactDeleteUrl(backendPath: string): string {
  const origin = getApiOrigin().replace(/\/+$/, "");
  const query = new URLSearchParams({ path: backendPath });
  return `${origin}/api/v1/artifacts?${query.toString()}`;
}

/** Turn a failed response into the `ORPCError` the rest of the app expects. */
async function throwForResponse(response: Response): Promise<never> {
  const body: unknown = await response.json().catch(() => undefined);
  throw new ORPCError(codeForStatus(response.status), {
    message: fastApiDetail(body) ?? response.statusText,
    data: body,
  });
}

/**
 * Download a produced video by the path the backend reported.
 *
 * Throws an `ORPCError` carrying the server's `{"detail": ...}` envelope, so the
 * caller can reuse `toAppError` (a `404` means the file is gone, `422` that the
 * path is outside the volumes the API serves).
 */
export async function fetchArtifact(backendPath: string): Promise<Blob> {
  const response = await fetch(artifactDownloadUrl(backendPath));

  if (!response.ok) {
    await throwForResponse(response);
  }

  return response.blob();
}

/**
 * Delete a file the backend staged or produced.
 *
 * Idempotent on the server side, so a retry after a dropped response is safe and
 * a file that is already gone is success rather than an error. A `422` means the
 * path is outside the directories the API owns, which is a bug in the caller.
 */
export async function discardArtifact(backendPath: string): Promise<void> {
  const response = await fetch(artifactDeleteUrl(backendPath), {
    method: "DELETE",
  });

  if (!response.ok) {
    await throwForResponse(response);
  }
}
