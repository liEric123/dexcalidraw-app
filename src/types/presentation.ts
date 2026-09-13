import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

export type ExcalidrawData = {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

export type VideoBlock = {
  id: string;
  name: string;
  src: string;
  fileName?: string;
  mimeType?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  objectFit: "contain" | "cover";
  trimStart?: number;
  trimEnd?: number;
  breakpoints?: number[];
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
};

export type FrameBounds = { x: number; y: number; width: number; height: number };

export type Slide = {
  id: string;
  title: string;
  excalidrawData: ExcalidrawData;
  videoBlocks: VideoBlock[];
  notes: string;
  notesDrawing?: ExcalidrawData;
  presentationFrame?: FrameBounds;
  /**
   * Ordered groups of element ids revealed one step at a time while
   * presenting. Elements in no group are always visible. See
   * `src/lib/revealSteps.ts`.
   */
  revealSteps?: string[][];
};

export type Presentation = {
  id: string;
  title: string;
  slides: Slide[];
  currentSlideId: string;
  createdAt: number;
  updatedAt: number;
  isTemplate?: boolean;
  /** Set when the deck is in the trash; absent for a live deck. */
  deletedAt?: number;
};

export type AppMode = "editor" | "present";
