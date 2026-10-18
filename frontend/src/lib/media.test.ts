import { describe, expect, it } from "vitest";
import type { StoreMediaRequest } from "../rpc/contract";
import {
  fileToBase64,
  isImageFile,
  MAX_UPLOAD_FILES,
  newUploadBucket,
  parentDirectory,
  stageFiles,
} from "./media";

function imageFile(name = "photo.png", bytes: number[] = [1, 2, 3]): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

describe("fileToBase64", () => {
  it("encodes the bytes without a data URL prefix", async () => {
    const encoded = await fileToBase64(imageFile("a.png", [72, 105]));

    expect(encoded).toBe("SGk=");
    expect(encoded.startsWith("data:")).toBe(false);
  });

  it("round-trips a file larger than one chunk", async () => {
    const bytes = Array.from({ length: 0x8000 + 5 }, () => 7);
    const encoded = await fileToBase64(imageFile("big.png", bytes));
    const decoded = Uint8Array.from(atob(encoded), (char) =>
      char.charCodeAt(0),
    );

    expect(decoded.length).toBe(bytes.length);
    expect(decoded[0]).toBe(7);
    expect(decoded.at(-1)).toBe(7);
  });
});

describe("newUploadBucket", () => {
  it("matches the pattern the API enforces", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(newUploadBucket()).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it("stays within the 32 characters the API allows", () => {
    expect(newUploadBucket().length).toBeLessThanOrEqual(32);
  });
});

describe("parentDirectory", () => {
  it("returns the backend folder of a container path", () => {
    expect(parentDirectory("/app/media/uploads/ab12/photo-9f.png")).toBe(
      "/app/media/uploads/ab12",
    );
  });

  it("understands Windows separators", () => {
    expect(parentDirectory("D:\\repo\\media\\uploads\\photo-9f.png")).toBe(
      "D:/repo/media/uploads",
    );
  });

  it("returns an empty string when there is no folder", () => {
    expect(parentDirectory("photo.png")).toBe("");
  });
});

describe("isImageFile", () => {
  it("accepts the extensions the media store accepts", () => {
    expect(isImageFile(imageFile("a.PNG"))).toBe(true);
    expect(isImageFile(imageFile("a.jpeg"))).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isImageFile(imageFile("notes.txt"))).toBe(false);
  });
});

describe("stageFiles", () => {
  it("uploads every file into one bucket and returns the stored paths", async () => {
    const requests: StoreMediaRequest[] = [];
    const paths = await stageFiles(
      [imageFile("a.png"), imageFile("b.png")],
      async (input) => {
        requests.push(input);
        return { path: `/app/media/uploads/bucket1/${input.filename}` };
      },
      "bucket1",
    );

    expect(paths).toEqual([
      "/app/media/uploads/bucket1/a.png",
      "/app/media/uploads/bucket1/b.png",
    ]);
    expect(requests.map((request) => request.directory)).toEqual([
      "bucket1",
      "bucket1",
    ]);
    expect(requests[0].content_base64).toBe("AQID");
  });

  it("refuses an empty selection", async () => {
    await expect(
      stageFiles([], async () => ({ path: "/x.png" })),
    ).rejects.toThrow("No files");
  });

  it("refuses more files than one upload may carry", async () => {
    const files = Array.from({ length: MAX_UPLOAD_FILES + 1 }, (_, index) =>
      imageFile(`photo-${index}.png`),
    );

    await expect(stageFiles(files, async () => ({ path: "/x.png" }))).rejects.toThrow(
      "Too many files",
    );
  });

  it("stops at the first failure so the caller sees the real error", async () => {
    const failing = async (): Promise<{ path: string }> => {
      throw new Error("backend said no");
    };

    await expect(stageFiles([imageFile()], failing)).rejects.toThrow(
      "backend said no",
    );
  });
});
