import { describe, expect, it } from "vitest";
import type { EventData } from "../rpc/contract";
import { frameDetail, itemDetail, runProgressFrom } from "./progress";

/**
 * Progress is read out of a stream that carries every run, so the rules that
 * matter are about *attribution*: a frame belongs to a view only if it is that
 * view's run, and a lifecycle frame is progress too.
 */
describe("Reading progress from an event", () => {
  it("has nothing to report without an event", () => {
    expect(runProgressFrom(undefined, "single")).toBeNull();
  });

  it("starts a single run at zero and completes it at a hundred", () => {
    const started: EventData = {
      event: "sketch.started",
      image: "/app/media/a.png",
      output_path: "/app/media/a.mp4",
    };
    const completed: EventData = {
      event: "sketch.completed",
      image: "/app/media/a.png",
      output_path: "/app/media/a.mp4",
    };

    expect(runProgressFrom(started, "single")).toEqual({ percent: 0 });
    expect(runProgressFrom(completed, "single")).toEqual({ percent: 100 });
  });

  it("carries the label and frame counter of a progress frame", () => {
    const progress: EventData = {
      event: "sketch.progress",
      image: "/app/media/a.png",
      output_path: "/app/media/a.mp4",
      percent: 50,
      label: "hand",
      frame: 120,
      total_frames: 240,
    };

    const read = runProgressFrom(progress, "single");
    expect(read).toEqual({
      percent: 50,
      label: "hand",
      frame: 120,
      totalFrames: 240,
    });
    expect(frameDetail(read)).toBe("frame 120 / 240");
    // A single run has no batch position to report.
    expect(itemDetail(read)).toBeUndefined();
  });

  it("carries the still of the frame the render just drew", () => {
    const progress: EventData = {
      event: "sketch.progress",
      image: "/app/media/a.png",
      output_path: "/app/media/a.mp4",
      percent: 45,
      label: "roof",
      frame: 108,
      total_frames: 240,
      preview_path: "/app/media/previews/9a/frame-0009.jpg",
    };

    expect(runProgressFrom(progress, "single")?.previewPath).toBe(
      "/app/media/previews/9a/frame-0009.jpg",
    );
  });

  it("carries a batch still too, since a batch draws one image at a time", () => {
    const progress: EventData = {
      event: "batch.progress",
      input_dir: "/app/media/uploads/e2e",
      percent: 62,
      item_index: 2,
      item_total: 5,
      preview_path: "/app/media/previews/9a/frame-0002.jpg",
    };

    expect(runProgressFrom(progress, "batch")?.previewPath).toBe(
      "/app/media/previews/9a/frame-0002.jpg",
    );
  });

  it("reads the position in a batch", () => {
    const progress: EventData = {
      event: "batch.progress",
      input_dir: "/app/media/uploads/e2e",
      percent: 62,
      label: "image",
      item_index: 2,
      item_total: 5,
      item_name: "b.png",
    };

    const read = runProgressFrom(progress, "batch");
    expect(read?.itemIndex).toBe(2);
    expect(itemDetail(read)).toBe("image 2 of 5 · b.png");
    // No frames reported in this shape: nothing to show rather than a fake 0/0.
    expect(frameDetail(read)).toBeUndefined();
  });

  it("ignores a run of the other kind", () => {
    const batchFrame: EventData = {
      event: "batch.progress",
      input_dir: "/app/media/uploads/e2e",
      percent: 10,
    };
    const singleFailure: EventData = {
      event: "sketch.failed",
      image: "/app/media/a.png",
      output_path: "/app/media/a.mp4",
      error: "unreadable",
    };

    expect(runProgressFrom(batchFrame, "single")).toBeNull();
    expect(runProgressFrom(singleFailure, "single")).toBeNull();
    expect(runProgressFrom(singleFailure, "batch")).toBeNull();
  });

  it("reports a batch position without a name", () => {
    expect(itemDetail({ percent: 0, itemIndex: 1, itemTotal: 2 })).toBe(
      "image 1 of 2",
    );
  });
});
