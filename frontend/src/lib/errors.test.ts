import { MalformedResponseError, ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import {
  codeForStatus,
  fastApiDetail,
  statusForCode,
  toAppError,
} from "./errors";

/**
 * These fixtures are exactly what the link now produces: the OpenAPI client is
 * configured with an error-body decoder (`rpc/index.ts`) that turns FastAPI's
 * `{"detail": ...}` envelope into a typed `ORPCError`, so the UI can tell a
 * missing file (404) from a bad payload (422) from a crash (500).
 */
const serverError = (code: string, body: unknown) =>
  new ORPCError(code, {
    message: fastApiDetail(body) ?? code,
    data: body,
  });

describe("error mapping", () => {
  it("round-trips HTTP statuses through oRPC codes", () => {
    expect(statusForCode("NOT_FOUND")).toBe(404);
    expect(statusForCode("UNPROCESSABLE_CONTENT")).toBe(422);
    expect(statusForCode("INTERNAL_SERVER_ERROR")).toBe(500);
    expect(codeForStatus(404)).toBe("NOT_FOUND");
    expect(codeForStatus(422)).toBe("UNPROCESSABLE_CONTENT");
    expect(codeForStatus(503)).toBe("SERVICE_UNAVAILABLE");
    // Unknown statuses still produce a usable code.
    expect(codeForStatus(418)).toBe("BAD_REQUEST");
    expect(codeForStatus(599)).toBe("INTERNAL_SERVER_ERROR");
  });

  it("explains path visibility for a 404, per mode", () => {
    const error = serverError("NOT_FOUND", {
      detail: "Image not found: C:\\nope\\missing.png",
    });

    const docker = toAppError(error, "docker");
    expect(docker.status).toBe(404);
    expect(docker.isPathVisibilityError).toBe(true);
    expect(docker.message).toContain("not visible to the backend");
    expect(docker.message).toContain("only reads files that were uploaded");
    expect(docker.verbatim).toContain("Image not found");

    const sidecar = toAppError(error, "sidecar");
    expect(sidecar.message).toContain("sidecar process");
  });

  it("surfaces the server detail for a 422", () => {
    const mapped = toAppError(
      serverError("UNPROCESSABLE_CONTENT", {
        detail: "No supported images found in C:\\void",
      }),
      "sidecar",
    );

    expect(mapped.status).toBe(422);
    expect(mapped.message).toBe("No supported images found in C:\\void");
  });

  it("renders FastAPI validation lists as `field: message`", () => {
    const mapped = toAppError(
      serverError("UNPROCESSABLE_CONTENT", {
        detail: [
          {
            type: "greater_than_equal",
            loc: ["body", "config", "frame_rate"],
            msg: "Input should be greater than or equal to 1",
            input: 0,
          },
        ],
      }),
      "sidecar",
    );

    expect(mapped.message).toBe(
      "config.frame_rate: Input should be greater than or equal to 1",
    );
  });

  it("marks a 500 as a backend processing error and keeps the verbatim text", () => {
    const mapped = toAppError(
      serverError("INTERNAL_SERVER_ERROR", { detail: "cv2 exploded" }),
      "sidecar",
    );

    expect(mapped.status).toBe(500);
    expect(mapped.message).toBe("Backend processing error: cv2 exploded");
    expect(mapped.verbatim).toContain("cv2 exploded");
  });

  it("falls back to MalformedResponseError for bodies without a detail", () => {
    const mapped = toAppError(
      new MalformedResponseError({
        response: {
          status: 502,
          headers: {},
          body: "<html>bad gateway</html>",
        },
      }),
      "docker",
    );

    expect(mapped.status).toBe(502);
    expect(mapped.message).toContain("Backend processing error");
    expect(mapped.verbatim).toBe("<html>bad gateway</html>");
  });

  it("reports a network failure as unreachable, with the origin", () => {
    const mapped = toAppError(new TypeError("Failed to fetch"), "docker");

    expect(mapped.status).toBeUndefined();
    expect(mapped.message).toContain("Cannot reach the backend at");
    expect(mapped.message).toContain("Failed to fetch");
  });

  it("reads a detail out of both FastAPI envelope shapes", () => {
    expect(fastApiDetail({ detail: "plain" })).toBe("plain");
    expect(fastApiDetail({ detail: [{ loc: ["body"], msg: "nope" }] })).toBe(
      "nope",
    );
    expect(fastApiDetail({ detail: [] })).toBeUndefined();
    expect(fastApiDetail("not an object")).toBeUndefined();
  });
});
