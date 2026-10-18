import { useMutation } from "@tanstack/react-query";
import { orpc } from "../rpc";

type StoreMediaOptions = Parameters<typeof orpc.storeMedia.mutationOptions>[0];

/**
 * Stage a picked file where the backend can read it — `POST /api/v1/media`.
 *
 * Only browsers need this: a desktop shell hands the backend a host path that
 * the compose mounts already expose. The response carries the absolute path the
 * server sees, usable as-is for `image_path` (single) or `input_dir` (batch).
 *
 * @example
 * const store = useStoreMedia();
 * const { path } = await store.mutateAsync({
 *   filename: file.name,
 *   content_base64: await fileToBase64(file),
 * });
 */
export function useStoreMedia(options?: StoreMediaOptions) {
  return useMutation(orpc.storeMedia.mutationOptions(options));
}
