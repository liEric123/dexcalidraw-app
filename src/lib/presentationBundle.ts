import { strToU8, Unzip, UnzipInflate } from "fflate";
import type { Presentation, Slide, VideoBlock, ExcalidrawData } from "../types/presentation";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import { fileToDataUrl, dataUrlToBlob } from "./file";
import { loadVideoBlobs } from "./videoStorage";

const BUNDLE_FORMAT = "excalidraw-video-deck-bundle";
const BUNDLE_VERSION = 1;

const VALID_VIDEO_MIME_TYPES = new Set(["video/webm", "video/mp4", "video/quicktime"]);
const VALID_FILE_MIME_TYPES = new Set([
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/x-icon",
  "image/avif",
  "image/jfif",
  "application/octet-stream",
]);

// Manifest DTO types, distinct from the app's Presentation type. Extracted
// fields hold an explicit { $bundleRef } marker instead of a real string, so
// they can never be confused with a genuinely-empty payload.
type BundleRef = { $bundleRef: string };
type ManifestVideoBlock = Omit<VideoBlock, "src"> & { src: BundleRef };
type ManifestBinaryFileData = Omit<BinaryFileData, "dataURL"> & { dataURL: BundleRef };
type ManifestExcalidrawData = Omit<ExcalidrawData, "files"> & { files: Record<string, ManifestBinaryFileData> };
type ManifestSlide = Omit<Slide, "excalidrawData" | "videoBlocks" | "notesDrawing"> & {
  excalidrawData: ManifestExcalidrawData;
  videoBlocks: ManifestVideoBlock[];
  notesDrawing?: ManifestExcalidrawData;
};
type ManifestPresentation = Omit<Presentation, "slides"> & { slides: ManifestSlide[] };

type BundleAsset = { kind: "video" | "file"; bundlePath: string; mimeType: string };

type BundleManifest = {
  bundleFormat: typeof BUNDLE_FORMAT;
  bundleVersion: typeof BUNDLE_VERSION;
  assets: Record<string, BundleAsset>;
  presentation: ManifestPresentation;
};

function parseDataUrlMimeType(dataUrl: string): string | null {
  const match = /^data:([^;,]+)[^,]*,/.exec(dataUrl);
  return match ? match[1] : null;
}

// Minimal ZIP writer: stored (uncompressed) entries with real sizes in the
// local headers.
//
// fflate's streaming `Zip`/`ZipPassThrough` always emits entries with data
// descriptors (sizes absent from local headers). A stored entry with a data
// descriptor cannot be re-read reliably by a streaming unzipper: the entry's
// end must be found by scanning the raw payload for the 4-byte descriptor
// signature, and a multi-hundred-megabyte video has a non-trivial chance of
// containing a false match, which silently truncates the entry (fflate's
// scanner does not validate candidates against a CRC). Writing sized headers
// ourselves removes that failure mode entirely, and lets entry payloads be
// appended to the output Blob *by reference*; video bytes are never
// materialized in JS. Only the CRC-32 pass streams through them chunk by
// chunk. Media entries are already-compressed formats, so stored entries
// also match the previous `level: 0` behavior.

const ZIP32_MAX_BYTES = 0xfffffffe; // zip64 is unsupported

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc: number, chunk: Uint8Array): number {
  for (let i = 0; i < chunk.length; i++) {
    crc = CRC_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc;
}

async function crc32OfBlob(blob: Blob): Promise<number> {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = crc32Update(crc, value);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(): { time: number; date: number } {
  const d = new Date();
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

type ZipEntryMeta = { nameBytes: Uint8Array; size: number; crc: number; offset: number };

function localHeader(entry: ZipEntryMeta, time: number, date: number): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(30 + entry.nameBytes.length);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, 0x04034b50, true);
  dv.setUint16(4, 20, true); // version needed to extract
  dv.setUint16(6, 0x0800, true); // general purpose flags: UTF-8 names
  dv.setUint16(8, 0, true); // compression method: stored
  dv.setUint16(10, time, true);
  dv.setUint16(12, date, true);
  dv.setUint32(14, entry.crc, true);
  dv.setUint32(18, entry.size, true); // compressed size
  dv.setUint32(22, entry.size, true); // uncompressed size
  dv.setUint16(26, entry.nameBytes.length, true);
  dv.setUint16(28, 0, true); // extra field length
  h.set(entry.nameBytes, 30);
  return h;
}

function centralHeader(entry: ZipEntryMeta, time: number, date: number): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(46 + entry.nameBytes.length);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, 0x02014b50, true);
  dv.setUint16(4, 20, true); // version made by
  dv.setUint16(6, 20, true); // version needed to extract
  dv.setUint16(8, 0x0800, true); // general purpose flags: UTF-8 names
  dv.setUint16(10, 0, true); // compression method: stored
  dv.setUint16(12, time, true);
  dv.setUint16(14, date, true);
  dv.setUint32(16, entry.crc, true);
  dv.setUint32(20, entry.size, true); // compressed size
  dv.setUint32(24, entry.size, true); // uncompressed size
  dv.setUint16(28, entry.nameBytes.length, true);
  // extra/comment lengths, disk number, internal/external attrs: all zero
  dv.setUint32(42, entry.offset, true); // local header offset
  h.set(entry.nameBytes, 46);
  return h;
}

function endOfCentralDirectory(count: number, cdSize: number, cdOffset: number): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(22);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, count, true); // entries on this disk
  dv.setUint16(10, count, true); // total entries
  dv.setUint32(12, cdSize, true);
  dv.setUint32(16, cdOffset, true);
  return h;
}

async function buildZipBlob(entries: { path: string; data: Blob }[]): Promise<Blob> {
  const { time, date } = dosDateTime();
  const parts: BlobPart[] = [];
  const centralParts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const { path, data } of entries) {
    const meta: ZipEntryMeta = {
      nameBytes: strToU8(path),
      size: data.size,
      crc: await crc32OfBlob(data),
      offset,
    };
    const header = localHeader(meta, time, date);
    parts.push(header, data);
    centralParts.push(centralHeader(meta, time, date));
    offset += header.length + data.size;
    if (offset > ZIP32_MAX_BYTES) {
      throw new Error("Cannot export: the presentation exceeds the 4 GB bundle limit.");
    }
  }
  let cdSize = 0;
  for (const part of centralParts) {
    parts.push(part);
    cdSize += part.length;
  }
  parts.push(endOfCentralDirectory(entries.length, cdSize, offset));
  return new Blob(parts, { type: "application/zip" });
}

// videoBlobs holds the stored payload for every video block id, loaded from
// IndexedDB by the caller. block.src (a runtime object URL) is never read.
export async function buildPresentationBundle(
  presentation: Presentation,
  videoBlobs: Map<string, Blob>
): Promise<Blob> {
  const assets: Record<string, BundleAsset> = {};
  const entries: { path: string; data: Blob }[] = [];
  let videoIndex = 0;
  let fileIndex = 0;

  function extractVideoBlock(block: VideoBlock): ManifestVideoBlock {
    const blob = videoBlobs.get(block.id);
    if (!blob || blob.size === 0) {
      throw new Error(`Cannot export: video "${block.name}" has no stored data.`);
    }
    if (!VALID_VIDEO_MIME_TYPES.has(blob.type)) {
      throw new Error(`Cannot export: video "${block.name}" has an unsupported mime type "${blob.type}".`);
    }
    const bundlePath = `videos/${videoIndex++}`;
    entries.push({ path: bundlePath, data: blob });
    assets[block.id] = { kind: "video", bundlePath, mimeType: blob.type };
    const { src: _src, ...rest } = block;
    void _src;
    return { ...rest, src: { $bundleRef: block.id } };
  }

  function extractFiles(
    files: BinaryFiles,
    slideId: string,
    scope: "canvas" | "notes"
  ): Record<string, ManifestBinaryFileData> {
    const result: Record<string, ManifestBinaryFileData> = {};
    for (const [fileId, fileData] of Object.entries(files)) {
      if (!fileData.dataURL || !fileData.dataURL.startsWith("data:")) {
        throw new Error(`Cannot export: an embedded image on slide "${slideId}" has no stored data.`);
      }
      const mimeType = parseDataUrlMimeType(fileData.dataURL);
      if (!mimeType) {
        throw new Error(`Cannot export: an embedded image on slide "${slideId}" has malformed data.`);
      }
      if (!VALID_FILE_MIME_TYPES.has(mimeType)) {
        throw new Error(`Cannot export: an embedded image on slide "${slideId}" has an unsupported mime type "${mimeType}".`);
      }
      const bundlePath = `files/${fileIndex++}`;
      entries.push({ path: bundlePath, data: dataUrlToBlob(fileData.dataURL) });
      const assetId = `${slideId}:${scope}:${fileId}`;
      assets[assetId] = { kind: "file", bundlePath, mimeType };
      const { dataURL: _dataURL, ...rest } = fileData;
      void _dataURL;
      result[fileId] = { ...rest, dataURL: { $bundleRef: assetId } };
    }
    return result;
  }

  const manifestSlides: ManifestSlide[] = [];
  for (const slide of presentation.slides) {
    const videoBlocks: ManifestVideoBlock[] = [];
    for (const block of slide.videoBlocks) {
      videoBlocks.push(extractVideoBlock(block));
    }
    const excalidrawFiles = extractFiles(slide.excalidrawData.files, slide.id, "canvas");
    const notesDrawing: ManifestExcalidrawData | undefined = slide.notesDrawing
      ? { ...slide.notesDrawing, files: extractFiles(slide.notesDrawing.files, slide.id, "notes") }
      : undefined;

    const manifestSlide: ManifestSlide = {
      ...slide,
      videoBlocks,
      excalidrawData: { ...slide.excalidrawData, files: excalidrawFiles },
      notesDrawing,
    };
    manifestSlides.push(manifestSlide);
  }

  const manifest: BundleManifest = {
    bundleFormat: BUNDLE_FORMAT,
    bundleVersion: BUNDLE_VERSION,
    assets,
    presentation: { ...presentation, slides: manifestSlides },
  };

  entries.unshift({
    path: "manifest.json",
    // Blob encodes strings as UTF-8.
    data: new Blob([JSON.stringify(manifest)], { type: "application/json" }),
  });

  return buildZipBlob(entries);
}

function sanitizeFileName(title: string): string {
  return title.replace(/\s+/g, "-") || "presentation";
}

export async function downloadPresentationBundle(presentation: Presentation): Promise<void> {
  const ids = presentation.slides.flatMap((s) => s.videoBlocks.map((b) => b.id));
  const videoBlobs = await loadVideoBlobs(ids);
  const blob = await buildPresentationBundle(presentation, videoBlobs);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFileName(presentation.title)}-backup.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

class BundleImportError extends Error {}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isBundleRef(v: unknown): v is BundleRef {
  return isObj(v) && typeof v.$bundleRef === "string";
}

// Resource limits for untrusted archives. Only manifest.json and asset
// entries (videos/N, files/N) are retained; every entry except the manifest
// must be stored uncompressed, so nothing in a bundle can decompress to more
// than the archive's own size except the (size-capped) manifest.
const MAX_ENTRY_COUNT = 4096;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_CENTRAL_DIR_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_ENTRY_BYTES = ZIP32_MAX_BYTES;
const ASSET_PATH_RE = /^(?:videos|files)\/\d+$/;

// Chunks are folded into intermediate Blobs once they exceed this size, so
// a large video entry never accumulates as raw bytes in the JS heap: the
// browser's blob storage can page flushed parts out of renderer memory.
const FLUSH_BYTES = 8 * 1024 * 1024;

// Cross-checks every retained entry against the archive's central directory,
// the authoritative record of entry sizes and CRC-32 values. Streaming
// extraction alone would silently accept flipped payload bytes.
async function verifyAgainstCentralDirectory(
  file: Blob,
  entries: Map<string, Blob>,
  crcs: Map<string, number>
): Promise<void> {
  // End-of-central-directory record: 22 bytes plus up to 65535 comment bytes.
  const tailSize = Math.min(file.size, 22 + 65535);
  const tail = new Uint8Array(await file.slice(file.size - tailSize).arrayBuffer());
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new BundleImportError("Bundle is missing its central directory.");
  }
  const count = tv.getUint16(eocd + 10, true);
  const cdSize = tv.getUint32(eocd + 12, true);
  const cdOffset = tv.getUint32(eocd + 16, true);
  if (count > MAX_ENTRY_COUNT || cdSize > MAX_CENTRAL_DIR_BYTES || cdOffset + cdSize > file.size) {
    throw new BundleImportError("Bundle central directory is malformed.");
  }

  const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const central = new Map<string, { crc: number; size: number }>();
  let pos = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > cd.length || dv.getUint32(pos, true) !== 0x02014b50) {
      throw new BundleImportError("Bundle central directory is malformed.");
    }
    const crc = dv.getUint32(pos + 16, true);
    const size = dv.getUint32(pos + 24, true); // uncompressed size
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    if (pos + 46 + nameLen > cd.length) {
      throw new BundleImportError("Bundle central directory is malformed.");
    }
    const name = new TextDecoder().decode(cd.subarray(pos + 46, pos + 46 + nameLen));
    central.set(name, { crc, size });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  for (const [name, blob] of entries) {
    const record = central.get(name);
    if (!record || record.size !== blob.size || record.crc !== crcs.get(name)) {
      throw new BundleImportError(`Bundle entry "${name}" is corrupted (checksum mismatch).`);
    }
  }
}

// Streams the zip through fflate's Unzip, collecting manifest and asset
// entries as Blobs. The archive is never held in memory as a whole: input
// chunks come from blob.stream(), and finished entries live in the browser's
// Blob storage. Unknown paths are drained and discarded; every retained entry
// is CRC-verified against the central directory afterwards.
async function unzipToEntryBlobs(file: Blob): Promise<Map<string, Blob>> {
  const entries = new Map<string, Blob>();
  const crcs = new Map<string, number>();
  const seenNames = new Set<string>();
  let entryCount = 0;
  let totalBytes = 0;
  let failure: Error | null = null;
  const fail = (e: Error) => {
    failure = failure ?? e;
  };

  const unzipper = new Unzip((entry) => {
    if (failure) return;
    if (++entryCount > MAX_ENTRY_COUNT) {
      fail(new BundleImportError("Bundle has too many entries."));
      return;
    }
    if (seenNames.has(entry.name)) {
      fail(new BundleImportError(`Bundle contains a duplicate entry "${entry.name}".`));
      return;
    }
    seenNames.add(entry.name);

    const isManifest = entry.name === "manifest.json";
    const isAsset = ASSET_PATH_RE.test(entry.name);
    if (!isManifest && entry.compression !== 0) {
      // Only the (size-capped) manifest may be deflated. Assets are
      // already-compressed media written stored, and unknown entries must be
      // rejected before start() so a decompression bomb is never inflated,
      // even to drain it.
      fail(new BundleImportError(`Bundle entry "${entry.name}" must be stored uncompressed.`));
      return;
    }
    const retain = isManifest || isAsset;

    const parts: Blob[] = [];
    // fflate types chunks as ArrayBufferLike-backed, but never emits
    // SharedArrayBuffer-backed views.
    let chunks: Uint8Array<ArrayBuffer>[] = [];
    let pending = 0;
    let entryBytes = 0;
    let crc = 0xffffffff;
    entry.ondata = (err, data, final) => {
      if (err) {
        fail(err);
        return;
      }
      if (failure) return;
      entryBytes += data.length;
      totalBytes += data.length;
      if (totalBytes > MAX_TOTAL_ENTRY_BYTES) {
        fail(new BundleImportError("Bundle contents are too large."));
        return;
      }
      if (isManifest && entryBytes > MAX_MANIFEST_BYTES) {
        fail(new BundleImportError("Bundle manifest is too large."));
        return;
      }
      if (!retain) return; // unknown paths: drained, counted, discarded
      crc = crc32Update(crc, data);
      chunks.push(data as Uint8Array<ArrayBuffer>);
      pending += data.length;
      if (pending >= FLUSH_BYTES || final) {
        parts.push(new Blob(chunks));
        chunks = [];
        pending = 0;
      }
      if (final) {
        entries.set(entry.name, new Blob(parts));
        crcs.set(entry.name, (crc ^ 0xffffffff) >>> 0);
      }
    };
    entry.start();
  });
  unzipper.register(UnzipInflate);

  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    unzipper.push(value, false);
    if (failure) {
      reader.cancel().catch(() => {});
      throw failure;
    }
  }
  unzipper.push(new Uint8Array(0), true);
  if (failure) throw failure;

  await verifyAgainstCentralDirectory(file, entries, crcs);
  return entries;
}

function resolveAssetEntry(
  refValue: unknown,
  expectedKind: "video" | "file",
  assets: Record<string, unknown>,
  entries: Map<string, Blob>
): Blob {
  if (!isBundleRef(refValue)) {
    throw new BundleImportError("Bundle presentation data is malformed (expected an asset reference).");
  }
  const asset = assets[refValue.$bundleRef];
  if (!isObj(asset)) {
    throw new BundleImportError(`Bundle is missing asset "${refValue.$bundleRef}".`);
  }
  if (asset.kind !== expectedKind) {
    throw new BundleImportError(`Bundle asset "${refValue.$bundleRef}" has an unexpected type.`);
  }
  if (typeof asset.bundlePath !== "string" || typeof asset.mimeType !== "string") {
    throw new BundleImportError(`Bundle asset "${refValue.$bundleRef}" is malformed.`);
  }
  const validSet = expectedKind === "video" ? VALID_VIDEO_MIME_TYPES : VALID_FILE_MIME_TYPES;
  if (!validSet.has(asset.mimeType)) {
    throw new BundleImportError(`Bundle asset "${refValue.$bundleRef}" has an unsupported mime type.`);
  }
  const entry = entries.get(asset.bundlePath);
  if (!entry || entry.size === 0) {
    throw new BundleImportError(`Bundle is missing data for asset "${refValue.$bundleRef}".`);
  }
  // slice() re-types the blob without copying its bytes.
  return entry.slice(0, entry.size, asset.mimeType);
}

async function reconstructFiles(
  files: unknown,
  assets: Record<string, unknown>,
  entries: Map<string, Blob>
): Promise<Record<string, unknown>> {
  if (!isObj(files)) {
    throw new BundleImportError("Bundle presentation data is malformed (expected files).");
  }
  const result: Record<string, unknown> = {};
  for (const [fileId, fileData] of Object.entries(files)) {
    if (!isObj(fileData)) {
      throw new BundleImportError("Bundle presentation data is malformed (expected a file entry).");
    }
    // Canvas images stay data URLs: Excalidraw consumes them directly and
    // they are orders of magnitude smaller than videos.
    const dataURL = await fileToDataUrl(resolveAssetEntry(fileData.dataURL, "file", assets, entries));
    result[fileId] = { ...fileData, dataURL };
  }
  return result;
}

export type ParsedPresentationBundle = {
  // Presentation data with every video src cleared to "". Not yet validated
  // as a Presentation; callers must run it through validatePresentation.
  presentation: unknown;
  // Stored payload per video block id found in `presentation`.
  videoBlobs: Map<string, Blob>;
};

async function reconstructPresentation(
  presentation: Record<string, unknown>,
  assets: Record<string, unknown>,
  entries: Map<string, Blob>
): Promise<ParsedPresentationBundle> {
  if (!Array.isArray(presentation.slides)) {
    throw new BundleImportError("Bundle presentation data is malformed (expected slides).");
  }

  const videoBlobs = new Map<string, Blob>();
  const slides: unknown[] = [];
  for (const rawSlide of presentation.slides) {
    if (!isObj(rawSlide)) {
      throw new BundleImportError("Bundle presentation data is malformed (expected a slide).");
    }

    const excalidrawData = isObj(rawSlide.excalidrawData) ? rawSlide.excalidrawData : {};
    const files = await reconstructFiles(excalidrawData.files ?? {}, assets, entries);

    const videoBlocks: unknown[] = [];
    for (const rawBlock of Array.isArray(rawSlide.videoBlocks) ? rawSlide.videoBlocks : []) {
      if (!isObj(rawBlock) || typeof rawBlock.id !== "string") {
        throw new BundleImportError("Bundle presentation data is malformed (expected a video block).");
      }
      const blob = resolveAssetEntry(rawBlock.src, "video", assets, entries);
      videoBlobs.set(rawBlock.id, blob);
      videoBlocks.push({ ...rawBlock, src: "" });
    }

    let notesDrawing: unknown;
    if (isObj(rawSlide.notesDrawing)) {
      const notesFiles = await reconstructFiles(rawSlide.notesDrawing.files ?? {}, assets, entries);
      notesDrawing = { ...rawSlide.notesDrawing, files: notesFiles };
    }

    slides.push({
      ...rawSlide,
      excalidrawData: { ...excalidrawData, files },
      videoBlocks,
      ...(notesDrawing ? { notesDrawing } : {}),
    });
  }

  return { presentation: { ...presentation, slides }, videoBlobs };
}

export async function parsePresentationBundle(file: Blob): Promise<ParsedPresentationBundle | string> {
  let entries: Map<string, Blob>;
  try {
    entries = await unzipToEntryBlobs(file);
  } catch (e) {
    if (e instanceof BundleImportError) return e.message;
    return "Could not read file — make sure it's a valid presentation bundle (.zip).";
  }

  const manifestBlob = entries.get("manifest.json");
  if (!manifestBlob) return "This file is not a valid presentation bundle (missing manifest).";

  let manifest: unknown;
  try {
    manifest = JSON.parse(await manifestBlob.text());
  } catch {
    return "This file is not a valid presentation bundle (corrupt manifest).";
  }

  if (!isObj(manifest) || manifest.bundleFormat !== BUNDLE_FORMAT) {
    return "This file is not a valid presentation bundle.";
  }
  if (manifest.bundleVersion !== BUNDLE_VERSION) {
    return `This bundle was created by an unsupported version (${String(manifest.bundleVersion)}).`;
  }
  if (!isObj(manifest.assets) || !isObj(manifest.presentation)) {
    return "This file is not a valid presentation bundle (malformed manifest).";
  }

  try {
    return await reconstructPresentation(manifest.presentation, manifest.assets, entries);
  } catch (e) {
    if (e instanceof BundleImportError) return e.message;
    return "Could not read presentation bundle.";
  }
}
