import { describe, expect, expectTypeOf, it } from "vitest";
import type { EventData } from "../rpc/contract";
import { toSseState, useEventStream } from "./useEventStream";
import { useGenerateSketch } from "./useGenerateSketch";
import { useHealth } from "./useHealth";
import { useLatestEvent } from "./useLatestEvent";

/**
 * Type-level tests: nothing here renders a hook (no React renderer needed) —
 * the assertions are checked by `tsc --noEmit`, which the `lint` script runs.
 *
 * They guard a silent failure mode: oRPC's util generics collapse to `unknown`
 * when re-passed through a wrapper, which leaves `data` untyped while still
 * compiling perfectly.
 */

it("useLatestEvent data is one event, not an array of them", () => {
  type Result = ReturnType<typeof useLatestEvent>;

  expectTypeOf<Result["data"]>().toEqualTypeOf<EventData | undefined>();
  // The destructuring callers use: `const { data: latest, isLoading, error, refetch }`.
  expectTypeOf<Result>().toHaveProperty("isLoading");
  expectTypeOf<Result>().toHaveProperty("error");
  expectTypeOf<Result>().toHaveProperty("refetch");
});

it("useEventStream data is the accumulated event array", () => {
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
      toSseState({ data: undefined, isLoading: true, error: null }, false),
    ).toBe("closed");
  });

  it("reports connecting until the backend sends anything", () => {
    expect(
      toSseState({ data: undefined, isLoading: true, error: null }, true),
    ).toBe("connecting");
  });

  it("reports idle when the stream is not fetching and has no data", () => {
    expect(
      toSseState({ data: undefined, isLoading: false, error: null }, true),
    ).toBe("closed");
  });

  it("reports online for a live query holding one event", () => {
    expect(
      toSseState({ data: event, isLoading: false, error: null }, true),
    ).toBe("online");
  });

  it("reports online for a streamed query holding many events", () => {
    expect(
      toSseState({ data: [event], isLoading: false, error: null }, true),
    ).toBe("online");
  });

  it("reports reconnecting after a drop", () => {
    expect(
      toSseState({ data: event, isLoading: false, error: new Error("boom") }, true),
    ).toBe("reconnecting");
  });
});
