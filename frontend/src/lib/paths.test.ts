import { describe, expect, it } from "vitest";
import {
  DEFAULT_PATH_CONFIG,
  mapBackendPathToHost,
  mapHostPathToBackend,
  mapOutputDirToBackend,
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

  it("keeps the subpath of a file already inside the mounted media folder", () => {
    const mapped = mapHostPathToBackend(
      "/my/project/media/batch/drawing.jpg",
      "docker",
      customConfig,
    );

    expect(mapped.backendPath).toBe("/app/media/batch/drawing.jpg");
    expect(mapped.needsCopy).toBe(false);
    expect(mapped.destinationHostPath).toBeUndefined();
  });

  it("treats a repo-relative ./media path as already staged", () => {
    const mapped = mapHostPathToBackend(
      "./media/e2e/batch/hand-mask.png",
      "docker",
      DEFAULT_PATH_CONFIG,
    );

    expect(mapped.backendPath).toBe("/app/media/e2e/batch/hand-mask.png");
    expect(mapped.needsCopy).toBe(false);
  });

  it("passes a container path through untouched", () => {
    const mapped = mapHostPathToBackend(
      "/app/media/already/there.png",
      "docker",
    );

    expect(mapped.backendPath).toBe("/app/media/already/there.png");
    expect(mapped.needsCopy).toBe(false);
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

describe("Output directory mapping", () => {
  const customConfig = {
    projectRoot: "/my/project",
    mediaSubdir: "media",
    outputSubdir: "output",
  };

  it("leaves an empty value empty", () => {
    expect(mapOutputDirToBackend("  ", "docker")).toBe("");
  });

  it("passes a host path through in sidecar mode", () => {
    expect(mapOutputDirToBackend("D:/renders", "sidecar")).toBe("D:/renders");
  });

  it("rewrites the mounted ./output folder for the container", () => {
    expect(mapOutputDirToBackend("./output/e2e", "docker")).toBe(
      "/app/output/e2e",
    );
    expect(mapOutputDirToBackend("output/e2e/", "docker")).toBe(
      "/app/output/e2e",
    );
    expect(
      mapOutputDirToBackend("/my/project/output/runs", "docker", customConfig),
    ).toBe("/app/output/runs");
    expect(mapOutputDirToBackend("./output", "docker")).toBe("/app/output");
  });

  it("keeps a container path untouched", () => {
    expect(mapOutputDirToBackend("/app/output/runs", "docker")).toBe(
      "/app/output/runs",
    );
  });

  it("does not redirect a directory outside the mount", () => {
    expect(mapOutputDirToBackend("D:/renders", "docker")).toBe("D:/renders");
  });
});
