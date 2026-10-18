import { ORPCError } from "@orpc/client";
import { getApiOrigin } from "../lib/apiOrigin";
import { codeForStatus, fastApiDetail } from "../lib/errors";

/**
 * Fetching files the backend produced.
 *
 * Every other call travels through the oRPC contract as JSON. This one cannot:
 * the response body *is* the video. So this module owns the single URL the app
 * builds by hand, and reports failures as the same `ORPCError` the contract
 * raises — so `toAppError` renders them identically.
 */

/** `GET /api/v1/artifacts/download` for one path the backend reported. */
export function artifactDownloadUrl(backendPath: string): string {
  const origin = getApiOrigin().replace(/\/+$/, "");
  const query = new URLSearchParams({ path: backendPath });
  return `${origin}/api/v1/artifacts/download?${query.toString()}`;
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
    const body: unknown = await response.json().catch(() => undefined);
    throw new ORPCError(codeForStatus(response.status), {
      message: fastApiDetail(body) ?? response.statusText,
      data: body,
    });
  }

  return response.blob();
}
