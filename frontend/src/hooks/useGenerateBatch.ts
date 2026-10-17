import { useMutation } from "@tanstack/react-query";
import { orpc } from "../rpc";

type GenerateBatchOptions = Parameters<
  typeof orpc.generateBatch.mutationOptions
>[0];

/**
 * One sketch video per image in a directory — `POST /api/v1/sketches/batch`.
 *
 * Runs synchronously on the server; `batch.started` / `batch.completed` arrive
 * on the event stream (`useEventStream`) while this promise is still pending.
 *
 * @example
 * const { mutate, data } = useGenerateBatch();
 * mutate({ input_dir: "/app/media/batch" });
 * // data.items -> per-image outcomes, mirroring the batch.completed payload
 */
export function useGenerateBatch(options?: GenerateBatchOptions) {
  return useMutation(orpc.generateBatch.mutationOptions(options));
}
