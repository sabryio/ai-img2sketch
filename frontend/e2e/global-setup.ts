import { ensureFixtures } from "./fixtures";

/**
 * Runs once before the suite: prepare the image workspace the specs generate
 * from, so every spec starts from an identical, empty output directory.
 */
export default function globalSetup(): void {
  ensureFixtures();
}
