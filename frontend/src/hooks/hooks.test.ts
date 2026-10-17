import { expectTypeOf, it } from "vitest";
import type { EventData } from "../rpc/contract";
import { useEventStream } from "./useEventStream";
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

it("useEventStream data is one discriminated event, not an array of them", () => {
  expectTypeOf<ReturnType<typeof useEventStream>["data"]>().toEqualTypeOf<
    EventData | undefined
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
