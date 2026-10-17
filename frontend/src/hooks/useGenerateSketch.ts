import { useMutation } from "@tanstack/react-query";
import { orpc } from "../rpc";

type GenerateSketchOptions = Parameters<
  typeof orpc.generateSketch.mutationOptions
>[0];

/**
 * One sketch video — `POST /api/v1/sketches`.
 *
 * The request is synchronous on the server and may run for minutes; per-step
 * progress arrives on the event stream (`useEventStream`), not from this
 * mutation. Pass `onSuccess` / `onError` to react to the outcome.
 *
 * @example
 * const { mutate, isPending, error } = useGenerateSketch({
 *   onSuccess: (data) => console.log(data.output_path),
 * });
 * mutate({ image_path: "/app/media/a.jpg" });
 */
export function useGenerateSketch(options?: GenerateSketchOptions) {
  return useMutation(orpc.generateSketch.mutationOptions(options));
}
