import { beforeEach, describe, expect, it } from "vitest";
import type { EventData } from "../rpc/contract";
import { useNotificationsStore } from "./notifications";

const reset = () => useNotificationsStore.setState({ toasts: [], events: [] });

beforeEach(reset);

describe("notifications store", () => {
  it("raises a toast for the first of a repeated pair of messages", () => {
    const { addToast } = useNotificationsStore.getState();

    // The POST rejection says "File or folder not visible to the backend…"
    // while the sketch.failed event carries the raw server detail; both
    // describe one failure and must not stack up as two toasts.
    addToast({
      type: "error",
      title: "Sketch Failed",
      message: "Image not found: /app/media/a.png",
    });
    addToast({
      type: "error",
      title: "Error (404)",
      message:
        'File or folder not visible to the backend. In Docker mode, files must be located in the mounted media directory (e.g. ./media) to be accessible to the container. Image not found: /app/media/a.png',
    });

    expect(useNotificationsStore.getState().toasts).toHaveLength(1);
  });

  it("keeps unrelated errors apart", () => {
    const { addToast } = useNotificationsStore.getState();

    addToast({ type: "error", title: "A", message: "Corrupt PNG header" });
    addToast({ type: "error", title: "B", message: "No supported images" });

    expect(useNotificationsStore.getState().toasts).toHaveLength(2);
  });

  it("caps the toast stack", () => {
    const { addToast } = useNotificationsStore.getState();

    for (let i = 0; i < 8; i += 1) {
      addToast({ type: "error", title: `E${i}`, message: `distinct-${i}` });
    }

    expect(useNotificationsStore.getState().toasts).toHaveLength(5);
  });

  it("ingests an event once, however many times it is handed over", () => {
    const event: EventData = {
      event: "sketch.completed",
      image: "/app/media/a.png",
      output_path: "/app/output/a.mp4",
    };

    const { ingest } = useNotificationsStore.getState();
    ingest(event);
    ingest(event);
    ingest(event);

    expect(useNotificationsStore.getState().events).toHaveLength(1);
    expect(useNotificationsStore.getState().events[0].name).toBe(
      "sketch.completed",
    );
  });

  it("toasts a stream failure exactly once", () => {
    const failed: EventData = {
      event: "sketch.failed",
      image: "/app/media/b.png",
      output_path: "/app/output/b.mp4",
      error: "Unreadable image",
    };

    const { ingest } = useNotificationsStore.getState();
    ingest(failed);
    ingest(failed);

    const { toasts, events } = useNotificationsStore.getState();
    expect(events).toHaveLength(1);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("Unreadable image");
  });

  it("does not toast successes — the mutation result already reports them", () => {
    const { ingest } = useNotificationsStore.getState();
    ingest({
      event: "batch.completed",
      input_dir: "/app/media/batch",
      succeeded: 2,
      failed: 0,
    });

    expect(useNotificationsStore.getState().toasts).toHaveLength(0);
    expect(useNotificationsStore.getState().events).toHaveLength(1);
  });

  it("keeps the newest 50 events", () => {
    const { ingest } = useNotificationsStore.getState();

    for (let i = 0; i < 55; i += 1) {
      ingest({
        event: "batch.started",
        input_dir: `/app/media/batch-${i}`,
      });
    }

    const { events } = useNotificationsStore.getState();
    expect(events).toHaveLength(50);
    expect(events[0].data).toMatchObject({ input_dir: "/app/media/batch-54" });
  });
});
