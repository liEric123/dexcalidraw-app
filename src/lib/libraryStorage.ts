import type { LibraryItem, LibraryItems } from "@excalidraw/excalidraw/types";

// Library items are stored in localStorage. For very large icon packs this key
// may compete with presentation metadata; migrate to IndexedDB if that becomes
// an issue in practice.
const KEY = "excalidraw-video-deck:library";

export function loadLibrary(): LibraryItems {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Lightweight structural guard: Excalidraw's own restore pipeline validates
    // elements when the items reach initialData, so a full restore is not needed here.
    return (parsed as unknown[]).filter(
      (item): item is LibraryItem =>
        !!item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).id === "string" &&
        Array.isArray((item as Record<string, unknown>).elements),
    );
  } catch {
    return [];
  }
}

export function saveLibrary(items: LibraryItems): void {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function clearLibrary(): void {
  localStorage.removeItem(KEY);
}
