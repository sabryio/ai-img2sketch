import { describe, expect, it } from "vitest";
import { getApiOrigin } from "../lib/apiOrigin";
import { artifactDownloadUrl } from "./artifacts";

/**
 * The URL is the one thing the app builds by hand (a download body cannot ride
 * the JSON contract), so it is pinned here: origin, path and an encoded query.
 */
describe("artifactDownloadUrl", () => {
  it("points at the download endpoint of the configured origin", () => {
    const url = artifactDownloadUrl("/app/output/run.mp4");

    expect(url).toBe(
      `${getApiOrigin()}/api/v1/artifacts/download?path=%2Fapp%2Foutput%2Frun.mp4`,
    );
  });

  it("encodes characters a raw query string would break on", () => {
    const url = artifactDownloadUrl("/app/media/run 1 & 2.mp4");

    expect(url).toContain("path=%2Fapp%2Fmedia%2Frun+1+%26+2.mp4");
    // One query separator only: the path cannot smuggle in a second parameter.
    expect(url.split("?")).toHaveLength(2);
  });
});
