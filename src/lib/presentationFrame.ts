import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { FrameBounds } from "../types/presentation";

export const PRESENTATION_FRAME_ID = "__presentation-frame-guide__";
export const PRESENTATION_FRAME: FrameBounds = {
  x: 0,
  y: 0,
  width: 1600,
  height: 900,
};

type MaybeFramedElement = ExcalidrawElement & { frameId?: string };

export function createPresentationFrameGuide(
  visible = true,
  bounds: FrameBounds = PRESENTATION_FRAME,
): ExcalidrawElement {
  return {
    id: PRESENTATION_FRAME_ID,
    type: "rectangle",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    angle: 0,
    strokeColor: "#60a5fa",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "dashed",
    roughness: 0,
    opacity: visible ? 55 : 0,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  } as unknown as ExcalidrawElement;
}

export function withoutPresentationFrameGuide(
  elements: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] {
  return elements
    .filter((el) => el.id !== PRESENTATION_FRAME_ID)
    .map((el) => {
      const maybeFramed = el as MaybeFramedElement;
      if (maybeFramed.frameId !== PRESENTATION_FRAME_ID) return el;

      const { frameId: _frameId, ...rest } = maybeFramed;
      void _frameId;
      return rest as ExcalidrawElement;
    });
}

export function extractFrameBounds(
  elements: readonly ExcalidrawElement[],
): FrameBounds | null {
  const frame = elements.find((el) => el.id === PRESENTATION_FRAME_ID && !el.isDeleted);
  if (!frame) return null;
  return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
}
