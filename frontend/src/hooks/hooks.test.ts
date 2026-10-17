import { describe, expect, expectTypeOf, it } from "vitest";
import type { EventData } from "../rpc/contract";
import { toSseState, useEventStream } from "./useEventStream";
import { useGenerateSketch } from "./useGenerateSketch";
import { useHealth } from "./useHealth";

/**
 * Type-level tests: nothing here renders a hook (no React renderer needed) —
 * the assertions are checked by `tsc --noEmit`, which the `lint` script runs.
 *
 * They guard a silent failure mode: oRPC's util generics collapse to `unknown`
 * when re-passed through a wrapper, which leaves `data` untyped while still
 * compiling perfectly.
 */

it("useEventStream data is the accumulated event array, not a single event", () => {
  expectTypeOf<ReturnType<typeof useEventStream>["data"]>().toEqualTypeOf<
    EventData[] | undefined
  >();
});

it("useHealth data is the health payload", () => {
  expectTypeOf<ReturnType<typeof useHealth>["data"]>().toEqualTypeOf<
    { status: "ok" } | undefined
  >();
});

it("useGenerateSketch is typed to the request and response DTOs", () => {
  type Result = ReturnType<typeof useGenerateSketch>;

  expectTypeOf<Parameters<Result["mutate"]>[0]>().toHaveProperty("image_path");
  expectTypeOf<Result["data"]>().toEqualTypeOf<
    { output_path: string } | undefined
  >();
});

const event: EventData = {
  event: "sketch.started",
  image: "/app/media/a.png",
  output_path: "/app/output/a.mp4",
};

describe("toSseState", () => {
  it("reports closed when the stream is not mounted", () => {
    expect(
      toSseState({ status: "pending", fetchStatus: "fetching", data: undefined }, false),
    ).toBe("closed");
  });

  it("reports connecting until the first event arrives", () => {
    expect(
      toSseState({ status: "pending", fetchStatus: "fetching", data: undefined }, true),
    ).toBe("connecting");
  });

  it("reports online once an event has been seen", () => {
    expect(
      toSseState({ status: "success", fetchStatus: "fetching", data: [event] }, true),
    ).toBe("online");
  });

  it("reports reconnecting after a drop", () => {
    expect(
      toSseState({ status: "error", fetchStatus: "idle", data: [event] }, true),
    ).toBe("reconnecting");
  });
});
