/**
 * Browser file picking: from a picked `File` to a path the backend can open.
 *
 * A container (and a browser) cannot hand the backend a host path, so the bytes
 * travel through `POST /api/v1/media` and come back as a path the backend owns.
 * The desktop app reads a picked host file the same way when the backend cannot
 * reach it. Everything in here is deliberately free of React and of the API
 * client: the views own the mutation, this module owns the encoding and the
 * rules.
 */

import type { StoreMediaRequest, StoredMedia } from "../rpc/contract";

/** Extensions the pickers offer and the backend's media store accepts. */
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".bmp"] as const;

/** `accept` attribute matching {@link IMAGE_EXTENSIONS}. */
export const IMAGE_ACCEPT = IMAGE_EXTENSIONS.join(",");

/** One upload is capped so a huge folder cannot stall the UI for minutes. */
export const MAX_UPLOAD_FILES = 50;

/** True when the backend would accept this file without a round trip. */
export function isImageFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * Base64 of a file's bytes, without the `data:` URL prefix.
 *
 * Chunked so a multi-megabyte image cannot blow the argument limit of
 * `String.fromCharCode`.
 */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

/**
 * Bucket name the API accepts (`^[a-z0-9][a-z0-9-]*$`, at most 32 chars), so
 * every file of one folder pick lands in the same folder.
 */
export function newUploadBucket(): string {
  // `crypto.randomUUID` needs a secure context, which a dev server reached over
  // a LAN address is not — fall back rather than fail the upload.
  const seed =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

  return seed.replaceAll("-", "").toLowerCase().slice(0, 32);
}

/** Parent of a backend path, using the separator the path was written with. */
export function parentDirectory(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const cut = normalized.lastIndexOf("/");
  return cut > 0 ? normalized.slice(0, cut) : "";
}

/**
 * Upload every file into one bucket and return the stored backend paths.
 *
 * Sequential on purpose: the API is a single local process, and one request at
 * a time keeps the progress readable and the memory flat.
 */
export async function stageFiles(
  files: File[],
  store: (input: StoreMediaRequest) => Promise<StoredMedia>,
  bucket?: string,
): Promise<string[]> {
  if (files.length === 0) {
    throw new Error("No files to upload");
  }
  if (files.length > MAX_UPLOAD_FILES) {
    throw new Error(
      `Too many files selected: ${files.length}. Upload at most ${MAX_UPLOAD_FILES} at a time.`,
    );
  }

  const paths: string[] = [];
  for (const file of files) {
    const stored = await store({
      filename: file.name,
      content_base64: await fileToBase64(file),
      directory: bucket,
    });
    paths.push(stored.path);
  }

  return paths;
}
