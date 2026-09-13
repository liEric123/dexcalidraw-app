import type { Presentation, Slide, ExcalidrawData } from "../types/presentation";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { generateId } from "./ids";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawEl = Record<string, any>;

function isObj(v: unknown): v is RawEl {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

function sortedFrames(frames: RawEl[]): RawEl[] {
  return [...frames].sort((a, b) => {
    const dx = asNumber(a.x, 0) - asNumber(b.x, 0);
    if (dx !== 0) return dx;
    return asNumber(a.y, 0) - asNumber(b.y, 0);
  });
}

function elementsInFrame(elements: RawEl[], frame: RawEl): RawEl[] {
  const frameId = typeof frame.id === "string" ? frame.id : null;
  const byFrameId = frameId
    ? elements.filter((el) => !el.isDeleted && el.type !== "frame" && el.frameId === frameId)
    : [];
  if (byFrameId.length > 0) return byFrameId;

  const fx = asNumber(frame.x, 0);
  const fy = asNumber(frame.y, 0);
  const fw = asNumber(frame.width, 0);
  const fh = asNumber(frame.height, 0);
  return elements.filter((el) => {
    if (el.isDeleted || el.type === "frame") return false;
    const cx = asNumber(el.x, 0) + asNumber(el.width, 0) / 2;
    const cy = asNumber(el.y, 0) + asNumber(el.height, 0) / 2;
    return cx >= fx && cx <= fx + fw && cy >= fy && cy <= fy + fh;
  });
}

function normalizeToOrigin(elements: RawEl[], frame: RawEl): RawEl[] {
  const fx = asNumber(frame.x, 0);
  const fy = asNumber(frame.y, 0);
  return elements.map((el) => {
    const { frameId: _frameId, ...rest } = el;
    void _frameId;
    return { ...rest, x: asNumber(el.x, 0) - fx, y: asNumber(el.y, 0) - fy };
  });
}

function minimalAppState(raw: unknown): Partial<AppState> {
  const state: Partial<AppState> = {};
  if (isObj(raw) && typeof raw.viewBackgroundColor === "string") {
    state.viewBackgroundColor = raw.viewBackgroundColor as AppState["viewBackgroundColor"];
  }
  return state;
}

function makeSlide(title: string, elements: RawEl[], appState: unknown, files: BinaryFiles): Slide {
  const excalidrawData: ExcalidrawData = {
    elements: elements as unknown as readonly ExcalidrawElement[],
    appState: minimalAppState(appState),
    files,
  };
  return { id: generateId(), title, excalidrawData, videoBlocks: [], notes: "" };
}

// Returns a Presentation on success or an error string on failure.
export function parseExcalidrawFile(fileName: string, rawJson: unknown): Presentation | string {
  if (!isObj(rawJson)) return "Not a valid Excalidraw file.";
  if (!Array.isArray(rawJson.elements)) return "Excalidraw file is missing an elements array.";

  const allElements = rawJson.elements.filter(isObj);
  const files = (isObj(rawJson.files) ? rawJson.files : {}) as BinaryFiles;
  const appState = rawJson.appState;

  const active = allElements.filter((el) => !el.isDeleted);
  const frames = active.filter((el) => el.type === "frame");

  const slides: Slide[] = frames.length > 0
    ? sortedFrames(frames).map((frame, i) => {
        const members = normalizeToOrigin(elementsInFrame(active, frame), frame);
        const title = typeof frame.name === "string" && frame.name.trim()
          ? frame.name.trim()
          : `Slide ${i + 1}`;
        return makeSlide(title, members, appState, files);
      })
    : [makeSlide("Slide 1", active.filter((el) => el.type !== "frame"), appState, files)];

  const title = fileName.replace(/\.(excalidraw|json)$/i, "").trim() || "Imported Excalidraw";
  return {
    id: generateId(),
    title,
    slides,
    currentSlideId: slides[0].id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
