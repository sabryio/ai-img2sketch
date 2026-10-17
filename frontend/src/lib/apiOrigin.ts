/**
 * The API origin the oRPC link talks to.
 *
 * Kept in its own module (rather than in a store) so the transport layer can
 * read it without depending on the UI, and so the Settings modal can change it
 * at runtime: the link's `origin` option is a function, so every request picks
 * up the current value.
 */

const STORAGE_KEY = "ai-img2sketch.api-origin";

/** Build-time default; `VITE_API_ORIGIN` overrides the localhost fallback. */
export const DEFAULT_API_ORIGIN: string =
  import.meta.env?.VITE_API_ORIGIN?.trim() || "http://localhost:8000";

/** Trim whitespace and trailing slashes; empty input falls back to the default. */
export function normalizeApiOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function readStoredOrigin(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) ?? "";
    return normalizeApiOrigin(stored) || DEFAULT_API_ORIGIN;
  } catch {
    // Storage can be unavailable (disabled cookies); the default still works.
    return DEFAULT_API_ORIGIN;
  }
}

let currentOrigin = readStoredOrigin();

/** The origin every request is sent to right now. */
export function getApiOrigin(): string {
  return currentOrigin;
}

/** Persist a new origin and return the normalized value that was stored. */
export function setApiOrigin(origin: string): string {
  const next = normalizeApiOrigin(origin) || DEFAULT_API_ORIGIN;
  currentOrigin = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not fatal: the in-memory value still applies for this session.
  }
  return next;
}
