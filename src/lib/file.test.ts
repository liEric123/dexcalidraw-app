import { describe, it, expect } from "vitest";
import { dataUrlToBlob } from "./file";

// dataUrlToBlob backs the one-time migration of legacy persisted video data
// URLs (old IndexedDB string records and localStorage-embedded srcs) to Blobs.

describe("dataUrlToBlob", () => {
  it("decodes a base64 data URL to exact bytes with the declared mime type", async () => {
    const blob = dataUrlToBlob("data:video/webm;base64,dmlkZW8=");
    expect(blob.type).toBe("video/webm");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([118, 105, 100, 101, 111]) // "video"
    );
  });

  it("decodes binary payloads including zero bytes", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 0]);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const blob = dataUrlToBlob(`data:video/mp4;base64,${btoa(binary)}`);
    expect(blob.type).toBe("video/mp4");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it("keeps only the mime type when the header carries extra parameters", () => {
    const blob = dataUrlToBlob("data:video/webm;codecs=vp9;base64,dmlkZW8=");
    expect(blob.type).toBe("video/webm");
  });

  it("decodes a percent-encoded (non-base64) data URL", async () => {
    const blob = dataUrlToBlob("data:text/plain,hello%20world");
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("hello world");
  });

  it("throws on a malformed data URL", () => {
    expect(() => dataUrlToBlob("not-a-data-url")).toThrow();
    expect(() => dataUrlToBlob("data:video/webm;base64")).toThrow(); // no comma
    expect(() => dataUrlToBlob("blob:http://localhost/abc")).toThrow();
  });
});
