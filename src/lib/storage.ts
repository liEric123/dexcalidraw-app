import type { Presentation, Slide, VideoBlock, ExcalidrawData, FrameBounds } from "../types/presentation";
import { validateRevealSteps } from "./revealSteps";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

const KEY_PREFIX = "excalidraw-video-deck:p:";
const OLD_KEY = "excalidraw-video-deck:presentation"; // legacy single-key format

function isStr(v: unknown): v is string { return typeof v === "string"; }
function isNum(v: unknown): v is number { return typeof v === "number" && isFinite(v); }
function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function validateVideoBlock(raw: unknown): VideoBlock | null {
  if (!isObj(raw)) return null;
  if (!isStr(raw.id)) return null;
  return {
    id: raw.id,
    name: isStr(raw.name) ? raw.name : "video",
    src: isStr(raw.src) ? raw.src : "",
    fileName: isStr(raw.fileName) ? raw.fileName : undefined,
    mimeType: isStr(raw.mimeType) ? raw.mimeType : undefined,
    x: isNum(raw.x) ? raw.x : 0.05,
    y: isNum(raw.y) ? raw.y : 0.1,
    width: isNum(raw.width) ? raw.width : 0.4,
    height: isNum(raw.height) ? raw.height : 0.35,
    objectFit: raw.objectFit === "cover" ? "cover" : "contain",
    trimStart: isNum(raw.trimStart) && raw.trimStart > 0 ? raw.trimStart : undefined,
    trimEnd: isNum(raw.trimEnd) && raw.trimEnd > 0 ? raw.trimEnd : undefined,
    breakpoints: Array.isArray(raw.breakpoints)
      ? (raw.breakpoints as unknown[]).filter((v): v is number => isNum(v) && v > 0).sort((a, b) => a - b)
      : undefined,
    autoplay: typeof raw.autoplay === "boolean" ? raw.autoplay : false,
    loop: typeof raw.loop === "boolean" ? raw.loop : false,
    muted: typeof raw.muted === "boolean" ? raw.muted : false,
  };
}

function validateFrameBounds(raw: unknown): FrameBounds | undefined {
  if (!isObj(raw)) return undefined;
  if (!isNum(raw.x) || !isNum(raw.y) || !isNum(raw.width) || !isNum(raw.height)) {
    return undefined;
  }
  if (raw.width <= 0 || raw.height <= 0) return undefined;
  return {
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
  };
}

function validateNotesDrawing(raw: unknown): ExcalidrawData | undefined {
  if (!isObj(raw)) return undefined;
  return {
    elements: (Array.isArray(raw.elements) ? raw.elements : []) as readonly ExcalidrawElement[],
    appState: {},
    files: (isObj(raw.files) ? raw.files : {}) as BinaryFiles,
  };
}

function validateSlide(raw: unknown): Slide | null {
  if (!isObj(raw) || !isStr(raw.id)) return null;

  const ed = isObj(raw.excalidrawData) ? raw.excalidrawData : {};
  const excalidrawData: ExcalidrawData = {
    elements: (Array.isArray(ed.elements) ? ed.elements : []) as readonly ExcalidrawElement[],
    appState: (isObj(ed.appState) ? ed.appState : {}) as Partial<AppState>,
    files: (isObj(ed.files) ? ed.files : {}) as BinaryFiles,
  };

  const videoBlocks = (Array.isArray(raw.videoBlocks) ? raw.videoBlocks : [])
    .map(validateVideoBlock)
    .filter((b): b is VideoBlock => b !== null);

  return {
    id: raw.id,
    title: isStr(raw.title) ? raw.title : "Untitled slide",
    excalidrawData,
    videoBlocks,
    notes: isStr(raw.notes) ? raw.notes : "",
    notesDrawing: validateNotesDrawing(raw.notesDrawing),
    presentationFrame: validateFrameBounds(raw.presentationFrame),
    revealSteps: validateRevealSteps(raw.revealSteps),
  };
}

export function validatePresentation(raw: unknown): Presentation | null {
  if (!isObj(raw) || !isStr(raw.id)) return null;

  const slides = (Array.isArray(raw.slides) ? raw.slides : [])
    .map(validateSlide)
    .filter((s): s is Slide => s !== null);

  const currentSlideId =
    slides.length === 0
      ? ""
      : isStr(raw.currentSlideId) && slides.some((s) => s.id === raw.currentSlideId)
      ? raw.currentSlideId
      : slides[0].id;

  return {
    id: raw.id,
    title: isStr(raw.title) ? raw.title : "Untitled",
    slides,
    currentSlideId,
    createdAt: isNum(raw.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : Date.now(),
    isTemplate: raw.isTemplate === true,
    deletedAt: isNum(raw.deletedAt) ? raw.deletedAt : undefined,
  };
}

export function savePresentation(presentation: Presentation): void {
  localStorage.setItem(`${KEY_PREFIX}${presentation.id}`, JSON.stringify(presentation));
}

export function loadPresentationById(id: string): Presentation | null {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${id}`);
    if (!raw) return null;
    return validatePresentation(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadMostRecentPresentation(): Presentation | null {
  const latest = listPresentations().find((m) => m.deletedAt === undefined);
  return latest ? loadPresentationById(latest.id) : null;
}

export function deletePresentationFromStorage(id: string): void {
  localStorage.removeItem(`${KEY_PREFIX}${id}`);
}

// Soft delete: the deck moves to the trash but its metadata (and any video
// Blobs, which this module never touches) stay in place until it's restored
// or purged. Returns false if the deck no longer exists.
export function softDeletePresentation(id: string): boolean {
  const p = loadPresentationById(id);
  if (!p) return false;
  savePresentation({ ...p, deletedAt: Date.now() });
  return true;
}

export function restorePresentation(id: string): boolean {
  const p = loadPresentationById(id);
  if (!p) return false;
  savePresentation({ ...p, deletedAt: undefined });
  return true;
}

// How long a soft-deleted deck stays recoverable before it's eligible for
// permanent purge. Purging (including its video Blobs) is orchestrated by
// the caller, not here, since this module has no IndexedDB dependency.
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function isTrashExpired(deletedAt: number, now: number = Date.now()): boolean {
  return now - deletedAt >= TRASH_RETENTION_MS;
}

export type PresentationMeta = {
  id: string;
  title: string;
  updatedAt: number;
  slideCount: number;
  isTemplate: boolean;
  deletedAt?: number;
};

export function listPresentations(): PresentationMeta[] {
  const metas: PresentationMeta[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(KEY_PREFIX)) continue;
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? "");
      if (isObj(raw) && isStr(raw.id) && isStr(raw.title)) {
        metas.push({
          id: raw.id,
          title: raw.title,
          updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : 0,
          slideCount: Array.isArray(raw.slides) ? raw.slides.length : 0,
          isTemplate: raw.isTemplate === true,
          deletedAt: isNum(raw.deletedAt) ? raw.deletedAt : undefined,
        });
      }
    } catch { /* skip corrupt entries */ }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Migrates the legacy single-presentation key to the new per-ID format.
// Returns the migrated presentation's ID, or null if nothing to migrate.
export function migrateOldStorageKey(): string | null {
  try {
    const raw = localStorage.getItem(OLD_KEY);
    if (!raw) return null;
    const validated = validatePresentation(JSON.parse(raw));
    if (!validated) { localStorage.removeItem(OLD_KEY); return null; }
    if (!localStorage.getItem(`${KEY_PREFIX}${validated.id}`)) {
      localStorage.removeItem(OLD_KEY);
      try {
        localStorage.setItem(`${KEY_PREFIX}${validated.id}`, raw);
      } catch (e) {
        localStorage.setItem(OLD_KEY, raw);
        throw e;
      }
    } else {
      localStorage.removeItem(OLD_KEY);
    }
    return validated.id;
  } catch {
    return null;
  }
}

export function stripVideoSrcs(p: Presentation): Presentation {
  return {
    ...p,
    slides: p.slides.map((s) => ({
      ...s,
      videoBlocks: s.videoBlocks.map((b) => ({ ...b, src: "" })),
    })),
  };
}

// Pre-hydration variant: legacy embedded data URLs must survive until they
// have been migrated to IndexedDB, but runtime object URLs (blob:) are
// session-scoped and must never be persisted.
export function stripRuntimeVideoSrcs(p: Presentation): Presentation {
  return {
    ...p,
    slides: p.slides.map((s) => ({
      ...s,
      videoBlocks: s.videoBlocks.map((b) =>
        b.src.startsWith("data:") ? b : { ...b, src: "" }
      ),
    })),
  };
}
