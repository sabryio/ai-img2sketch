import { describe, expect, it } from "vitest";
import {
  getBasename,
  isBackendPath,
  normalizePath,
  planInputPath,
  planOutput,
} from "./paths";

/**
 * The path rules are what keeps a Docker backend from being handed a path it
 * cannot open. They are pinned here because a wrong answer is not a cosmetic
 * bug: the request would come back as a 404 from the API.
 */
describe("Path helpers", () => {
  it("normalizes Windows separators", () => {
    expect(normalizePath("C:\\images\\cat.png")).toBe("C:/images/cat.png");
    expect(normalizePath("./media/a.png")).toBe("./media/a.png");
  });

  it("reads the base name of either separator style", () => {
    expect(getBasename("/app/media/uploads/e2e/cat.png")).toBe("cat.png");
    expect(getBasename("C:\\images\\cat.png")).toBe("cat.png");
    expect(getBasename("cat.png")).toBe("cat.png");
  });
});

describe("Backend path detection", () => {
  it("accepts a container path in Docker mode", () => {
    expect(isBackendPath("/app/media/uploads/x.png", "docker")).toBe(true);
    expect(isBackendPath("/app", "docker")).toBe(true);
    expect(isBackendPath("  /app/output/run.mp4  ", "docker")).toBe(true);
  });

  it("rejects anything the container cannot see", () => {
    expect(isBackendPath("./media/x.png", "docker")).toBe(false);
    expect(isBackendPath("D:/renders/x.png", "docker")).toBe(false);
    expect(isBackendPath("C:\\images\\cat.png", "docker")).toBe(false);
    // Only the whole `/app` segment counts: `/apple` is not the container root.
    expect(isBackendPath("/apple/x.png", "docker")).toBe(false);
  });

  it("accepts every host path in sidecar mode", () => {
    expect(isBackendPath("D:/renders/x.png", "sidecar")).toBe(true);
    expect(isBackendPath("./media/x.png", "sidecar")).toBe(true);
  });
});

describe("Input planning", () => {
  it("sends nothing for an empty value", () => {
    expect(planInputPath("   ", "docker")).toEqual({
      path: "",
      needsUpload: false,
    });
  });

  it("passes a host path through untouched in sidecar mode", () => {
    expect(planInputPath("D:/photos/cat.png", "sidecar")).toEqual({
      path: "D:/photos/cat.png",
      needsUpload: false,
    });
  });

  it("flags a host path for upload in Docker mode", () => {
    // A container has no host mounts, so a path inside the project is no more
    // readable than one on another drive.
    expect(planInputPath("./media/e2e/hand-mask.png", "docker")).toEqual({
      path: "./media/e2e/hand-mask.png",
      needsUpload: true,
    });
    expect(planInputPath("C:\\images\\cat.png", "docker").needsUpload).toBe(true);
  });

  it("sends an already-uploaded path as-is in Docker mode", () => {
    expect(planInputPath("/app/media/uploads/e2e/cat.png", "docker")).toEqual({
      path: "/app/media/uploads/e2e/cat.png",
      needsUpload: false,
    });
  });
});

describe("Output planning", () => {
  it("sends nothing when the folder is empty, which means 'beside the image'", () => {
    expect(planOutput("  ", "docker", false)).toEqual({});
    expect(planOutput("", "sidecar", true)).toEqual({});
  });

  it("lets a native backend write any host folder directly", () => {
    expect(planOutput("D:/renders", "sidecar", false)).toEqual({
      backendOutputDir: "D:/renders",
    });
  });

  it("hands the container a folder the container owns", () => {
    expect(planOutput("/app/output/runs", "docker", true)).toEqual({
      backendOutputDir: "/app/output/runs",
    });
  });

  it("exports to a host folder the container cannot reach, in the desktop app", () => {
    expect(planOutput("D:/renders", "docker", true)).toEqual({
      exportDir: "D:/renders",
      note: "exported",
    });
    expect(planOutput("./output/runs", "docker", true)).toEqual({
      exportDir: "./output/runs",
      note: "exported",
    });
  });

  it("asks the user to download instead when no host copy is possible", () => {
    expect(planOutput("D:/renders", "docker", false)).toEqual({
      exportDir: "D:/renders",
      note: "download",
    });
  });
});
