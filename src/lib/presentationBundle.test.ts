import { describe, it, expect, vi } from "vitest";
import { zipSync, unzipSync, strToU8, strFromU8, Zip, ZipPassThrough } from "fflate";
import { buildPresentationBundle, parsePresentationBundle } from "./presentationBundle";
import { validatePresentation } from "./storage";
import type { Presentation, VideoBlock, Slide } from "../types/presentation";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

// Minimal FileReader shim: this Vitest suite runs under `environment: "node"`
// (see vite.config.ts), but presentationBundle.ts uses the browser FileReader
// API (via fileToDataUrl) to turn reconstructed image bytes back into data URLs.
class FileReaderShim {
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  result: string | null = null;
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer()
      .then((buf) => {
        let binary = "";
        for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte);
        this.result = `data:${blob.type};base64,${btoa(binary)}`;
        this.onload?.();
      })
      .catch((e) => this.onerror?.(e));
  }
}
vi.stubGlobal("FileReader", FileReaderShim);

const VIDEO_BYTES = new Uint8Array([118, 105, 100, 101, 111, 0, 255, 1, 2, 3]);
const TINY_PNG_A = "data:image/png;base64,aGVsbG8=";
const TINY_PNG_B = "data:image/png;base64,d29ybGQ=";

function makeVideoBlob(type = "video/webm", bytes: Uint8Array<ArrayBuffer> = VIDEO_BYTES): Blob {
  return new Blob([bytes], { type });
}

function makeVideoBlock(overrides: Partial<VideoBlock> = {}): VideoBlock {
  return {
    id: "video-1",
    name: "Clip",
    src: "",
    x: 0.1,
    y: 0.1,
    width: 0.3,
    height: 0.3,
    objectFit: "contain",
    autoplay: false,
    loop: false,
    muted: true,
    ...overrides,
  };
}

function makeFiles(entries: Record<string, string>): BinaryFiles {
  const files: Record<string, unknown> = {};
  for (const [id, dataURL] of Object.entries(entries)) {
    files[id] = { id, dataURL, mimeType: "image/png", created: 1 };
  }
  return files as unknown as BinaryFiles;
}

function makeSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    id: "slide-1",
    title: "Slide 1",
    excalidrawData: { elements: [], appState: {}, files: {} },
    videoBlocks: [],
    notes: "",
    ...overrides,
  };
}

function makePresentation(slides: Slide[]): Presentation {
  return {
    id: "deck-1",
    title: "Deck",
    slides,
    currentSlideId: slides[0]?.id ?? "",
    createdAt: 1,
    updatedAt: 2,
  };
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function findSequence(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

async function validBundleBytes(): Promise<Uint8Array> {
  const slide = makeSlide({ videoBlocks: [makeVideoBlock()] });
  const bundle = await buildPresentationBundle(
    makePresentation([slide]),
    new Map([["video-1", makeVideoBlob()]])
  );
  return blobBytes(bundle);
}

describe("buildPresentationBundle / parsePresentationBundle round trip", () => {
  it("round-trips a video block's exact bytes and mime type plus a canvas image", async () => {
    const slide = makeSlide({
      videoBlocks: [makeVideoBlock()],
      excalidrawData: { elements: [], appState: {}, files: makeFiles({ "file-1": TINY_PNG_A }) },
    });
    const bundle = await buildPresentationBundle(
      makePresentation([slide]),
      new Map([["video-1", makeVideoBlob("video/mp4")]])
    );
    const parsed = await parsePresentationBundle(bundle);

    expect(typeof parsed).not.toBe("string");
    if (typeof parsed === "string") return;

    const validated = validatePresentation(parsed.presentation);
    expect(validated).not.toBeNull();
    // Video srcs are never reconstructed as data; they stay empty until the
    // app assigns a runtime object URL.
    expect(validated!.slides[0].videoBlocks[0].src).toBe("");
    expect(validated!.slides[0].excalidrawData.files["file-1"].dataURL).toBe(TINY_PNG_A);

    const blob = parsed.videoBlobs.get("video-1");
    expect(blob).toBeDefined();
    expect(blob!.type).toBe("video/mp4");
    expect(await blobBytes(blob!)).toEqual(VIDEO_BYTES);
  });

  it("round-trips notesDrawing files", async () => {
    const slide = makeSlide({
      notesDrawing: { elements: [], appState: {}, files: makeFiles({ "note-file-1": TINY_PNG_A }) },
    });
    const bundle = await buildPresentationBundle(makePresentation([slide]), new Map());
    const parsed = await parsePresentationBundle(bundle);
    if (typeof parsed === "string") throw new Error(parsed);

    const validated = validatePresentation(parsed.presentation);
    expect(validated!.slides[0].notesDrawing?.files["note-file-1"].dataURL).toBe(TINY_PNG_A);
  });

  it("round-trips reveal steps", async () => {
    const slide = makeSlide({ revealSteps: [["el-a"], ["el-b", "el-c"]] });
    const bundle = await buildPresentationBundle(makePresentation([slide]), new Map());
    const parsed = await parsePresentationBundle(bundle);
    if (typeof parsed === "string") throw new Error(parsed);

    const validated = validatePresentation(parsed.presentation);
    expect(validated!.slides[0].revealSteps).toEqual([["el-a"], ["el-b", "el-c"]]);
  });

  it("preserves distinct images when the same fileId appears on two slides", async () => {
    const slideA = makeSlide({
      id: "slide-a",
      excalidrawData: { elements: [], appState: {}, files: makeFiles({ "shared-id": TINY_PNG_A }) },
    });
    const slideB = makeSlide({
      id: "slide-b",
      excalidrawData: { elements: [], appState: {}, files: makeFiles({ "shared-id": TINY_PNG_B }) },
    });
    const bundle = await buildPresentationBundle(makePresentation([slideA, slideB]), new Map());
    const parsed = await parsePresentationBundle(bundle);
    if (typeof parsed === "string") throw new Error(parsed);

    const validated = validatePresentation(parsed.presentation);
    expect(validated!.slides[0].excalidrawData.files["shared-id"].dataURL).toBe(TINY_PNG_A);
    expect(validated!.slides[1].excalidrawData.files["shared-id"].dataURL).toBe(TINY_PNG_B);
  });

  it("keeps separate blobs for two video blocks", async () => {
    const bytesA = new Uint8Array([1, 1, 1]);
    const bytesB = new Uint8Array([2, 2, 2, 2]);
    const slide = makeSlide({
      videoBlocks: [makeVideoBlock({ id: "video-a" }), makeVideoBlock({ id: "video-b" })],
    });
    const bundle = await buildPresentationBundle(
      makePresentation([slide]),
      new Map([
        ["video-a", makeVideoBlob("video/webm", bytesA)],
        ["video-b", makeVideoBlob("video/quicktime", bytesB)],
      ])
    );
    const parsed = await parsePresentationBundle(bundle);
    if (typeof parsed === "string") throw new Error(parsed);

    expect(await blobBytes(parsed.videoBlobs.get("video-a")!)).toEqual(bytesA);
    expect(parsed.videoBlobs.get("video-a")!.type).toBe("video/webm");
    expect(await blobBytes(parsed.videoBlobs.get("video-b")!)).toEqual(bytesB);
    expect(parsed.videoBlobs.get("video-b")!.type).toBe("video/quicktime");
  });
});

describe("bundle zip container interop", () => {
  it("produces a zip readable by fflate's central-directory unzip with exact stored bytes", async () => {
    const bytes = await validBundleBytes();
    const unzipped = unzipSync(bytes);
    expect(Object.keys(unzipped).sort()).toEqual(["manifest.json", "videos/0"]);
    expect(unzipped["videos/0"]).toEqual(VIDEO_BYTES);
    const manifest = JSON.parse(strFromU8(unzipped["manifest.json"]));
    expect(manifest.bundleFormat).toBe("excalidraw-video-deck-bundle");
    expect(manifest.assets["video-1"].mimeType).toBe("video/webm");
  });
});

describe("buildPresentationBundle export validation", () => {
  it("throws when a video block has no stored blob", async () => {
    const slide = makeSlide({ videoBlocks: [makeVideoBlock()] });
    await expect(
      buildPresentationBundle(makePresentation([slide]), new Map())
    ).rejects.toThrow(/has no stored data/);
  });

  it("throws when a video block's stored blob is empty", async () => {
    const slide = makeSlide({ videoBlocks: [makeVideoBlock()] });
    await expect(
      buildPresentationBundle(
        makePresentation([slide]),
        new Map([["video-1", makeVideoBlob("video/webm", new Uint8Array(0))]])
      )
    ).rejects.toThrow(/has no stored data/);
  });

  it("throws when a canvas image has no stored data", async () => {
    const slide = makeSlide({
      excalidrawData: { elements: [], appState: {}, files: makeFiles({ "file-1": "" }) },
    });
    await expect(buildPresentationBundle(makePresentation([slide]), new Map())).rejects.toThrow(/has no stored data/);
  });

  it("throws when a video blob has an unsupported mime type", async () => {
    const slide = makeSlide({ videoBlocks: [makeVideoBlock()] });
    await expect(
      buildPresentationBundle(
        makePresentation([slide]),
        new Map([["video-1", makeVideoBlob("video/x-matroska")]])
      )
    ).rejects.toThrow(/unsupported mime type/);
  });

  it("throws when a canvas image has an unsupported mime type", async () => {
    const slide = makeSlide({
      excalidrawData: {
        elements: [],
        appState: {},
        files: makeFiles({ "file-1": "data:text/plain;base64,aGVsbG8=" }),
      },
    });
    await expect(buildPresentationBundle(makePresentation([slide]), new Map())).rejects.toThrow(/unsupported mime type/);
  });
});

describe("parsePresentationBundle rejection — nothing is reconstructed on failure", () => {
  it("rejects a completely malformed byte blob", async () => {
    const result = await parsePresentationBundle(new Blob([new Uint8Array([1, 2, 3, 4, 5])]));
    expect(typeof result).toBe("string");
  });

  it("rejects a zip missing manifest.json", async () => {
    const bytes = zipSync({ "readme.txt": strToU8("hi") }, { level: 0 });
    const result = await parsePresentationBundle(new Blob([bytes]));
    expect(result).toMatch(/missing manifest/);
  });

  it("rejects a zip with the wrong bundleFormat", async () => {
    const manifest = { bundleFormat: "something-else", bundleVersion: 1, assets: {}, presentation: {} };
    const bytes = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)) });
    const result = await parsePresentationBundle(new Blob([bytes]));
    expect(result).toMatch(/not a valid presentation bundle/);
  });

  it("rejects an unsupported bundleVersion", async () => {
    const manifest = {
      bundleFormat: "excalidraw-video-deck-bundle",
      bundleVersion: 99,
      assets: {},
      presentation: { slides: [] },
    };
    const bytes = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)) });
    const result = await parsePresentationBundle(new Blob([bytes]));
    expect(result).toMatch(/unsupported version/i);
  });

  it("rejects a $bundleRef whose asset is absent from the assets table", async () => {
    const manifest = {
      bundleFormat: "excalidraw-video-deck-bundle",
      bundleVersion: 1,
      assets: {},
      presentation: {
        id: "deck-1",
        title: "Deck",
        currentSlideId: "slide-1",
        createdAt: 1,
        updatedAt: 2,
        slides: [
          {
            id: "slide-1",
            title: "Slide 1",
            notes: "",
            excalidrawData: { elements: [], appState: {}, files: {} },
            videoBlocks: [{ ...makeVideoBlock(), src: { $bundleRef: "video-1" } }],
          },
        ],
      },
    };
    const bytes = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)) });
    const result = await parsePresentationBundle(new Blob([bytes]));
    expect(result).toMatch(/missing asset/);
  });

  it("rejects an asset whose bundlePath has no corresponding zip entry", async () => {
    const unzipped = unzipSync(await validBundleBytes());
    delete unzipped["videos/0"];
    const result = await parsePresentationBundle(new Blob([zipSync(unzipped, { level: 0 })]));
    expect(result).toMatch(/missing data/);
  });

  it("rejects a zero-byte asset entry", async () => {
    const unzipped = unzipSync(await validBundleBytes());
    unzipped["videos/0"] = new Uint8Array(0);
    const result = await parsePresentationBundle(new Blob([zipSync(unzipped, { level: 0 })]));
    expect(result).toMatch(/missing data/);
  });

  it("rejects an asset with an invalid mime type", async () => {
    const unzipped = unzipSync(await validBundleBytes());
    const manifest = JSON.parse(strFromU8(unzipped["manifest.json"]));
    const assetId = Object.keys(manifest.assets)[0];
    manifest.assets[assetId].mimeType = "text/plain";
    unzipped["manifest.json"] = strToU8(JSON.stringify(manifest));
    const result = await parsePresentationBundle(new Blob([zipSync(unzipped, { level: 0 })]));
    expect(result).toMatch(/unsupported mime type/);
  });
});

describe("parsePresentationBundle corruption and resource limits", () => {
  it("rejects a bundle whose video payload has a flipped byte", async () => {
    const bytes = await validBundleBytes();
    // Video entries are stored uncompressed, so the payload appears verbatim
    // in the archive; locate it and flip one byte without touching headers.
    const offset = findSequence(bytes, VIDEO_BYTES);
    expect(offset).toBeGreaterThan(-1);
    const corrupted = bytes.slice();
    corrupted[offset + 3] ^= 0xff;
    const result = await parsePresentationBundle(new Blob([corrupted]));
    expect(result).toMatch(/corrupted/);
  });

  it("rejects duplicate entry paths", async () => {
    const bytes = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      const zip = new Zip((err, chunk, final) => {
        if (err) return reject(err);
        chunks.push(chunk as Uint8Array<ArrayBuffer>);
        if (final) {
          const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let pos = 0;
          for (const c of chunks) {
            out.set(c, pos);
            pos += c.length;
          }
          resolve(out);
        }
      });
      for (let i = 0; i < 2; i++) {
        const entry = new ZipPassThrough("videos/0");
        zip.add(entry);
        entry.push(strToU8("data"), true);
      }
      zip.end();
    });
    const result = await parsePresentationBundle(new Blob([bytes]));
    expect(result).toMatch(/duplicate entry/);
  });

  it("rejects a bundle with too many entries", async () => {
    const junk: Record<string, Uint8Array> = {};
    for (let i = 0; i < 4097; i++) junk[`junk/${i}`] = new Uint8Array(0);
    const result = await parsePresentationBundle(new Blob([zipSync(junk, { level: 0 })]));
    expect(result).toMatch(/too many entries/);
  });

  it("rejects a compressed (deflated) asset entry", async () => {
    const unzipped = unzipSync(await validBundleBytes());
    // Default zipSync level deflates every entry, including videos/0.
    const result = await parsePresentationBundle(new Blob([zipSync(unzipped)]));
    expect(result).toMatch(/must be stored uncompressed/);
  });

  it("rejects a deflated unknown entry without inflating it", async () => {
    // A compressed non-manifest entry is a decompression-bomb vector even if
    // its contents would be discarded, so it must be rejected outright.
    const unzipped = unzipSync(await validBundleBytes());
    const zippable: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
    for (const [name, bytes] of Object.entries(unzipped)) {
      zippable[name] = [bytes, { level: 0 }];
    }
    zippable["extra/bomb.bin"] = [new Uint8Array(64 * 1024), { level: 6 }];
    const result = await parsePresentationBundle(new Blob([zipSync(zippable)]));
    expect(result).toMatch(/must be stored uncompressed/);
  });

  it("ignores unknown stored entry paths and still parses the bundle", async () => {
    const unzipped = unzipSync(await validBundleBytes());
    unzipped["extra/readme.txt"] = strToU8("not part of the format");
    const result = await parsePresentationBundle(new Blob([zipSync(unzipped, { level: 0 })]));
    expect(typeof result).not.toBe("string");
  });
});
