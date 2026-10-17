import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkHealth,
  generateBatchSketches,
  generateSketch,
  parseApiError,
  setApiBase,
} from "./client";
import { BatchSketchRequest, SketchRequest } from "./types";

describe("API Client Unit Tests & Error Mapping", () => {
  beforeEach(() => {
    setApiBase("http://localhost:8000");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts SketchRequest fixture and returns SketchResponse", async () => {
    const fixtureRequest: SketchRequest = {
      image_path: "/app/media/sample_input.png",
      output_dir: "/app/output",
      config: {
        frame_rate: 30,
        split_len: 12,
        object_skip_rate: 6,
        draw_duration_sec: 4.5,
        end_duration_sec: 2.0,
        black_pixel_threshold: 15,
      },
    };

    const fixtureResponse = {
      output_path: "/app/output/sample_input_sketch.mp4",
      duration_sec: 6.5,
      frame_count: 195,
      status: "completed",
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureResponse,
    });

    const res = await generateSketch(fixtureRequest, "docker");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/sketches",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(fixtureRequest),
      }),
    );

    expect(res).toEqual(fixtureResponse);
  });

  it("posts BatchSketchRequest fixture and returns BatchSketchResponse", async () => {
    const fixtureBatchRequest: BatchSketchRequest = {
      input_dir: "/app/media/images",
      output_dir: "/app/output",
      config: {
        frame_rate: 25,
        split_len: 10,
        object_skip_rate: 8,
      },
    };

    const fixtureBatchResponse = {
      items: [
        { image: "img1.png", output_path: "/app/output/img1.mp4" },
        { image: "img2.png", output_path: null, error: "Corrupt header" },
      ],
      total: 2,
      succeeded: 1,
      failed: 1,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureBatchResponse,
    });

    const res = await generateBatchSketches(fixtureBatchRequest, "docker");
    expect(res).toEqual(fixtureBatchResponse);
  });

  it("maps 404 to file visibility error mentioning active mode (Docker)", async () => {
    const mockResponse = {
      status: 404,
      text: async () => JSON.stringify({ detail: "File not found" }),
      statusText: "Not Found",
    } as unknown as Response;

    const error = await parseApiError(mockResponse, "docker");

    expect(error.status).toBe(404);
    expect(error.isPathVisibilityError).toBe(true);
    expect(error.message).toContain(
      "File or folder not visible to the backend",
    );
    expect(error.message).toContain("Docker mode");
  });

  it("maps 404 to file visibility error mentioning active mode (Sidecar)", async () => {
    const mockResponse = {
      status: 404,
      text: async () => JSON.stringify({ detail: "File not found" }),
      statusText: "Not Found",
    } as unknown as Response;

    const error = await parseApiError(mockResponse, "sidecar");

    expect(error.status).toBe(404);
    expect(error.isPathVisibilityError).toBe(true);
    expect(error.message).toContain("sidecar mode");
  });

  it("maps 422 to the first detail message", async () => {
    const mockResponse = {
      status: 422,
      text: async () =>
        JSON.stringify({
          detail: [
            {
              loc: ["body", "config", "frame_rate"],
              msg: "ensure this value is greater than or equal to 1",
              type: "value_error.number.not_ge",
            },
            {
              loc: ["body", "config", "split_len"],
              msg: "another error",
            },
          ],
        }),
      statusText: "Unprocessable Entity",
    } as unknown as Response;

    const error = await parseApiError(mockResponse);

    expect(error.status).toBe(422);
    expect(error.message).toContain(
      "ensure this value is greater than or equal to 1",
    );
  });

  it("maps 500 to verbatim message for local debugging", async () => {
    const verbatimServerStack =
      "OpenCV(4.8.0) error: (-215:Assertion failed) !ssize.empty() in function resize";

    const mockResponse = {
      status: 500,
      text: async () => JSON.stringify({ detail: verbatimServerStack }),
      statusText: "Internal Server Error",
    } as unknown as Response;

    const error = await parseApiError(mockResponse);

    expect(error.status).toBe(500);
    expect(error.verbatim).toBe(verbatimServerStack);
    expect(error.message).toContain(verbatimServerStack);
  });
});
