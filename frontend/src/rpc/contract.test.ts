import { describe, expect, it } from "vitest";
import { EventDataSchema } from "./contract";

/**
 * Fixtures are exactly what the backend publishes (see the event catalogue in
 * `docs/api.md` / `docs/orpc-sse-wire-format.md`). They exist to make schema
 * drift fail here rather than silently in the UI: if the server renames a
 * field, these break before an event is ever dropped at runtime.
 */
const contractFixtures = [
  {
    event: "sketch.started",
    image: "/app/media/a.jpg",
    output_path: "/app/output/a.mp4",
  },
  {
    event: "sketch.completed",
    image: "/app/media/a.jpg",
    output_path: "/app/output/a.mp4",
  },
  {
    event: "sketch.failed",
    image: "/app/media/a.jpg",
    output_path: "/app/output/a.mp4",
    error: "Image not readable",
  },
  { event: "batch.started", input_dir: "/app/media/batch" },
  {
    event: "batch.completed",
    input_dir: "/app/media/batch",
    succeeded: 3,
    failed: 1,
  },
  { event: "batch.failed", input_dir: "/app/media/batch", error: "No images" },
];

describe("EventDataSchema", () => {
  it.each(contractFixtures)(
    "accepts the $event frame the server sends",
    (fixture) => {
      expect(EventDataSchema.safeParse(fixture).success).toBe(true);
    },
  );

  it("narrows on the event discriminant", () => {
    const parsed = EventDataSchema.parse({
      event: "batch.completed",
      input_dir: "/app/media/batch",
      succeeded: 3,
      failed: 1,
    });

    // Exhaustive narrowing is what the UI relies on.
    if (parsed.event !== "batch.completed") {
      throw new Error(`expected batch.completed, got ${parsed.event}`);
    }
    expect(parsed.succeeded).toBe(3);
    expect(parsed.failed).toBe(1);
  });

  it("rejects an unknown event name", () => {
    expect(
      EventDataSchema.safeParse({ event: "sketch.exploded", image: "a" })
        .success,
    ).toBe(false);
  });

  it("rejects a payload without the discriminant", () => {
    expect(
      EventDataSchema.safeParse({ image: "a", output_path: "b" }).success,
    ).toBe(false);
  });
});
