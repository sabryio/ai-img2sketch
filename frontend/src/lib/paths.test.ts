import { describe, expect, it } from "vitest";
import {
  DEFAULT_PATH_CONFIG,
  mapBackendPathToHost,
  mapHostPathToBackend,
} from "./paths";

describe("Paths Mapping Unit Tests (Docker vs Sidecar)", () => {
  const customConfig = {
    projectRoot: "/my/project",
    mediaSubdir: "media",
    outputSubdir: "output",
  };

  it("preserves paths as-is in sidecar mode", () => {
    const input = "/home/user/photos/cat.png";
    const mapped = mapHostPathToBackend(input, "sidecar");
    expect(mapped.backendPath).toBe(input);
    expect(mapped.needsCopy).toBe(false);

    const output = "/home/user/photos/cat_sketch.mp4";
    const hostOutput = mapBackendPathToHost(output, "sidecar");
    expect(hostOutput).toBe(output);
  });

  it("maps host path to /app/media/<filename> and flags copy in Docker mode", () => {
    const input = "/Users/artist/Desktop/drawing.jpg";
    const mapped = mapHostPathToBackend(input, "docker", customConfig);

    expect(mapped.backendPath).toBe("/app/media/drawing.jpg");
    expect(mapped.needsCopy).toBe(true);
    expect(mapped.destinationHostPath).toBe("/my/project/media/drawing.jpg");
  });

  it("maps backend /app/output/... back to host output directory in Docker mode", () => {
    const backendOut = "/app/output/sketch_001.mp4";
    const hostOut = mapBackendPathToHost(backendOut, "docker", customConfig);

    expect(hostOut).toBe("/my/project/output/sketch_001.mp4");
  });

  it("handles relative default path configuration properly", () => {
    const backendOut = "/app/output/sketch_sample.mp4";
    const hostOut = mapBackendPathToHost(
      backendOut,
      "docker",
      DEFAULT_PATH_CONFIG,
    );

    expect(hostOut).toBe("./output/sketch_sample.mp4");
  });
});
