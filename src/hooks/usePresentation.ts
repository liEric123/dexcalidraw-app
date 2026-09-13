import { useState, useCallback, useEffect, useRef } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Presentation, ExcalidrawData, VideoBlock, FrameBounds, Slide } from "../types/presentation";
import { createDefaultPresentation, createDefaultSlide } from "../lib/defaults";
import {
  savePresentation,
  loadPresentationById,
  validatePresentation,
  stripVideoSrcs,
  stripRuntimeVideoSrcs,
} from "../lib/storage";
import { parseExcalidrawFile } from "../lib/excalidrawImport";
import { cloneRevealSteps } from "../lib/revealSteps";
import { dataUrlToBlob } from "../lib/file";
import { generateId } from "../lib/ids";
import { saveVideoBlob, loadVideoBlobs, copyVideoBlob, deleteVideo } from "../lib/videoStorage";
import type { ParsedPresentationBundle } from "../lib/presentationBundle";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

// Migrate video blocks that were saved with absolute pixel coordinates
// (the old format). Detected by width > 1 since normalized width is always ≤ 1.
const MIGRATE_W = 1280;
const MIGRATE_H = 800;

function migratePresentation(p: Presentation): Presentation {
  const needsMigration = p.slides.some((s) =>
    s.videoBlocks.some((b) => b.width > 1 || b.height > 1)
  );
  if (!needsMigration) return p;
  return {
    ...p,
    slides: p.slides.map((s) => ({
      ...s,
      videoBlocks: s.videoBlocks.map((b) =>
        b.width > 1 || b.height > 1
          ? {
              ...b,
              x: b.x / MIGRATE_W,
              y: b.y / MIGRATE_H,
              width: b.width / MIGRATE_W,
              height: b.height / MIGRATE_H,
            }
          : b
      ),
    })),
  };
}

function cloneExcalidrawData(data: ExcalidrawData): ExcalidrawData {
  return {
    elements: data.elements.map((el) => ({ ...el })),
    appState: { ...data.appState },
    files: { ...data.files },
  };
}

function deleteVideosBestEffort(ids: string[]): void {
  ids.forEach((id) => {
    deleteVideo(id).catch(() => {});
  });
}

function videoIds(presentation: Presentation): string[] {
  return presentation.slides.flatMap((s) => s.videoBlocks.map((b) => b.id));
}

function rekeyImportedPresentation(presentation: Presentation): {
  presentation: Presentation;
  videoIdPairs: { oldId: string; newId: string }[];
} {
  const slideIds = new Map<string, string>();
  const videoIdPairs: { oldId: string; newId: string }[] = [];
  const slides = presentation.slides.map((slide) => {
    const id = generateId();
    slideIds.set(slide.id, id);
    return {
      ...slide,
      id,
      excalidrawData: cloneExcalidrawData(slide.excalidrawData),
      videoBlocks: slide.videoBlocks.map((block) => {
        const newId = generateId();
        videoIdPairs.push({ oldId: block.id, newId });
        return {
          ...block,
          id: newId,
          breakpoints: block.breakpoints ? [...block.breakpoints] : undefined,
        };
      }),
      notesDrawing: slide.notesDrawing ? cloneExcalidrawData(slide.notesDrawing) : undefined,
      presentationFrame: slide.presentationFrame ? { ...slide.presentationFrame } : undefined,
    };
  });

  return {
    presentation: {
      ...presentation,
      slides,
      currentSlideId: slideIds.get(presentation.currentSlideId) ?? slides[0]?.id ?? "",
    },
    videoIdPairs,
  };
}

export function usePresentation(presentationId: string) {
  const [presentation, setPresentation] = useState<Presentation>(
    () => migratePresentation(loadPresentationById(presentationId) ?? createDefaultPresentation())
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isHydrated, setIsHydrated] = useState(false);

  // suppressSaveCount: suppress status toasts for the first 2 auto-saves
  // (initial sync load + async hydration merge) so the UI stays quiet on startup.
  const suppressSaveCount = useRef(2);
  const canStripVideoSrcsRef = useRef(false);

  // savedTimerRef: "saved" → "idle" after 2 s
  // statusTransitionRef: deferred setSaveStatus call from the save effect (0 ms)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const statusTransitionRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Kept in sync so async operations always see the latest committed presentation
  // without closing over a stale snapshot.
  const presentationRef = useRef(presentation);
  useEffect(() => { presentationRef.current = presentation; }, [presentation]);

  // One owned object URL per stored video id. VideoBlock.src only ever holds
  // "" or one of these blob: URLs (legacy data: URLs may pass through
  // transiently until hydration migrates them). Every path that removes or
  // replaces a stored video must revoke its URL here.
  const objectUrlsRef = useRef<Map<string, string>>(new Map());

  // Video ids the user has filled, replaced, or deleted this session. The
  // hydration effect runs concurrently with user actions and must never
  // clobber them: it skips migrating, re-saving, or creating URLs for any id
  // marked here. Ids are marked before the mutation's first await so an
  // in-flight hydration pass sees them as early as possible.
  const mutatedVideoIdsRef = useRef<Set<string>>(new Set());

  const markVideosMutated = useCallback((ids: string[]) => {
    for (const id of ids) mutatedVideoIdsRef.current.add(id);
  }, []);

  const setVideoUrl = useCallback((id: string, blob: Blob): string => {
    const existing = objectUrlsRef.current.get(id);
    if (existing) URL.revokeObjectURL(existing);
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.set(id, url);
    return url;
  }, []);

  const revokeVideoUrls = useCallback((ids: string[]) => {
    for (const id of ids) {
      const url = objectUrlsRef.current.get(id);
      if (url) {
        URL.revokeObjectURL(url);
        objectUrlsRef.current.delete(id);
      }
    }
  }, []);

  // Revoke every owned URL on unmount (including StrictMode's throwaway
  // mount; the second hydration run recreates them).
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // Clear all pending status timers on unmount.
  useEffect(() => {
    return () => {
      clearTimeout(savedTimerRef.current);
      clearTimeout(statusTransitionRef.current);
    };
  }, []);

  // Auto-save: strip video srcs before writing to localStorage. After
  // hydration all srcs are runtime object URLs and are stripped wholesale;
  // before hydration, legacy embedded data: URLs must survive (they haven't
  // been migrated to IndexedDB yet) but blob: URLs are still stripped.
  useEffect(() => {
    const suppress = suppressSaveCount.current > 0;
    if (suppress) suppressSaveCount.current--;
    try {
      savePresentation(
        canStripVideoSrcsRef.current ? stripVideoSrcs(presentation) : stripRuntimeVideoSrcs(presentation)
      );
      if (!suppress) {
        clearTimeout(statusTransitionRef.current);
        statusTransitionRef.current = setTimeout(() => {
          setSaveStatus("saved");
          clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
        }, 0);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        if (!suppress) {
          clearTimeout(statusTransitionRef.current);
          statusTransitionRef.current = setTimeout(() => setSaveStatus("error"), 0);
        }
      }
    }
  }, [presentation]);

  // Hydration: load stored video Blobs from IndexedDB (migrating legacy
  // string records in the process), migrate data URLs still embedded in
  // localStorage (old format), then create playback object URLs. Runs once
  // on mount.
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      let stored: Map<string, Blob>;
      try {
        const current = presentationRef.current;
        const ids = current.slides.flatMap((s) => s.videoBlocks.map((b) => b.id));
        stored = await loadVideoBlobs(ids);
      } catch {
        if (cancelled) return;
        const hasOnlyLoadedVideos = presentationRef.current.slides.every((s) =>
          s.videoBlocks.every((b) => b.src)
        );
        if (hasOnlyLoadedVideos) setIsHydrated(true);
        setSaveStatus("error");
        return;
      }
      if (cancelled) return;

      // Migrate old-format: blocks with data URLs embedded in localStorage
      // but not yet in IndexedDB. One at a time; the embedded src is only
      // stripped (via canStripVideoSrcsRef) once every migration succeeded.
      const allBlocks = presentationRef.current.slides.flatMap((s) => s.videoBlocks);
      const toMigrate = allBlocks.filter((b) => b.src.startsWith("data:") && !stored.has(b.id));
      let migrationFailed = false;
      for (const block of toMigrate) {
        // Re-checked per iteration (each earlier iteration awaited): a video
        // the user filled, replaced, or deleted meanwhile must not have its
        // stale legacy payload written back.
        if (mutatedVideoIdsRef.current.has(block.id)) continue;
        try {
          const blob = dataUrlToBlob(block.src);
          await saveVideoBlob(block.id, blob);
          stored.set(block.id, blob);
        } catch {
          migrationFailed = true;
        }
        if (cancelled) return;
      }

      canStripVideoSrcsRef.current = !migrationFailed;
      setIsHydrated(true);
      if (migrationFailed) setSaveStatus("error");

      // No awaits from here on: URLs are registered in objectUrlsRef
      // synchronously, so a StrictMode unmount either returned at a cancelled
      // check above (no URLs created) or revokes them via the unmount cleanup.
      // Ids that already own a URL (video added/filled while hydration ran)
      // keep the newer URL; ids mutated meanwhile (e.g. deleted) get no
      // orphan URL.
      const urls = objectUrlsRef.current;
      for (const [id, blob] of stored) {
        if (!urls.has(id) && !mutatedVideoIdsRef.current.has(id)) {
          urls.set(id, URL.createObjectURL(blob));
        }
      }
      setPresentation((prev) => ({
        ...prev,
        slides: prev.slides.map((s) => ({
          ...s,
          videoBlocks: s.videoBlocks.map((b) => ({
            ...b,
            // Fall back to the existing src for blocks without a stored blob:
            // a legacy data: URL whose migration failed stays playable, and
            // "" keeps showing "Video missing".
            src: urls.get(b.id) ?? b.src,
          })),
        })),
      }));
    }
    hydrate();
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((updater: (p: Presentation) => Presentation) => {
    setSaveStatus("saving");
    setPresentation((prev) => updater({ ...prev, updatedAt: Date.now() }));
  }, []);

  const selectSlide = useCallback((id: string) => {
    update((p) => ({ ...p, currentSlideId: id }));
  }, [update]);

  const addSlide = useCallback(() => {
    update((p) => {
      const slide = createDefaultSlide(`Slide ${p.slides.length + 1}`);
      const idx = p.slides.findIndex((s) => s.id === p.currentSlideId);
      const slides = [...p.slides];
      slides.splice(idx + 1, 0, slide);
      return { ...p, slides, currentSlideId: slide.id };
    });
  }, [update]);

  // Insert a new slide right after the current one, pre-populated with the
  // given elements (e.g. a converted Mermaid diagram). Inherits the current
  // slide's background and presentation-frame position, and selects the new
  // slide.
  const addSlideWithElements = useCallback((elements: readonly ExcalidrawElement[]) => {
    update((p) => {
      const idx = p.slides.findIndex((s) => s.id === p.currentSlideId);
      const current = idx >= 0 ? p.slides[idx] : undefined;
      const background = current?.excalidrawData.appState.viewBackgroundColor;
      const slide: Slide = {
        ...createDefaultSlide(`Slide ${p.slides.length + 1}`),
        excalidrawData: {
          elements: elements.map((el) => ({ ...el })),
          appState: background ? { viewBackgroundColor: background } : {},
          files: {},
        },
        presentationFrame: current?.presentationFrame
          ? { ...current.presentationFrame }
          : undefined,
      };
      const slides = [...p.slides];
      slides.splice(idx + 1, 0, slide);
      return { ...p, slides, currentSlideId: slide.id };
    });
  }, [update]);

  const deleteSlide = useCallback((id: string) => {
    const slide = presentationRef.current.slides.find((s) => s.id === id);
    if (slide) {
      const ids = slide.videoBlocks.map((b) => b.id);
      markVideosMutated(ids);
      revokeVideoUrls(ids);
      deleteVideosBestEffort(ids);
    }
    update((p) => {
      const idx = p.slides.findIndex((s) => s.id === id);
      if (idx === -1) return p;
      const slides = p.slides.filter((s) => s.id !== id);
      const currentSlideId = slides.length > 0
        ? slides[Math.min(idx, slides.length - 1)].id
        : "";
      return { ...p, slides, currentSlideId };
    });
  }, [update, revokeVideoUrls, markVideosMutated]);

  const renameSlide = useCallback((id: string, title: string) => {
    update((p) => ({
      ...p,
      slides: p.slides.map((s) => (s.id === id ? { ...s, title } : s)),
    }));
  }, [update]);

  const moveSlide = useCallback((id: string, direction: "up" | "down") => {
    update((p) => {
      const slides = [...p.slides];
      const idx = slides.findIndex((s) => s.id === id);
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= slides.length) return p;
      [slides[idx], slides[target]] = [slides[target], slides[idx]];
      return { ...p, slides };
    });
  }, [update]);

  const reorderSlide = useCallback((id: string, toIndex: number) => {
    update((p) => {
      const from = p.slides.findIndex((s) => s.id === id);
      if (from === -1) return p;
      const slides = [...p.slides];
      const [removed] = slides.splice(from, 1);
      slides.splice(toIndex > from ? toIndex - 1 : toIndex, 0, removed);
      return { ...p, slides };
    });
  }, [update]);

  // Async: copies stored video Blobs in IndexedDB under fresh IDs before
  // committing state. Blob records are copied as handles; their bytes are
  // never read into JS.
  const duplicateSlide = useCallback(async (id: string): Promise<void> => {
    const original = presentationRef.current.slides.find((s) => s.id === id);
    if (!original) return;

    // Pre-generate new block IDs and copy their stored videos in IndexedDB.
    const newVideoBlocks: VideoBlock[] = original.videoBlocks.map((b) => ({
      ...b,
      id: generateId(),
      src: "",
      breakpoints: b.breakpoints ? [...b.breakpoints] : undefined,
    }));
    const savedIds: string[] = [];
    for (let i = 0; i < original.videoBlocks.length; i++) {
      let copied: Blob | null;
      try {
        copied = await copyVideoBlob(original.videoBlocks[i].id, newVideoBlocks[i].id);
        // Legacy deck duplicated before hydration finished migrating its
        // embedded data URLs to IndexedDB: convert the embedded src directly.
        if (!copied && original.videoBlocks[i].src.startsWith("data:")) {
          copied = dataUrlToBlob(original.videoBlocks[i].src);
          await saveVideoBlob(newVideoBlocks[i].id, copied);
        }
      } catch {
        revokeVideoUrls(savedIds);
        deleteVideosBestEffort(savedIds);
        setSaveStatus("error");
        return;
      }
      if (!copied) continue; // missing source degrades to "Video missing"
      savedIds.push(newVideoBlocks[i].id);
      newVideoBlocks[i].src = setVideoUrl(newVideoBlocks[i].id, copied);
    }

    // The source slide may have been deleted while its videos were copying;
    // don't leak the copied records and URLs.
    if (!presentationRef.current.slides.some((s) => s.id === id)) {
      revokeVideoUrls(savedIds);
      deleteVideosBestEffort(savedIds);
      return;
    }

    const newSlideId = generateId();
    update((p) => {
      const idx = p.slides.findIndex((s) => s.id === id);
      if (idx === -1) return p;
      const orig = p.slides[idx];
      const copy = {
        ...orig,
        id: newSlideId,
        title: `${orig.title} (copy)`,
        excalidrawData: cloneExcalidrawData(orig.excalidrawData),
        videoBlocks: newVideoBlocks,
        presentationFrame: orig.presentationFrame
          ? { ...orig.presentationFrame }
          : undefined,
        // cloneExcalidrawData keeps element ids, so the copy's reveal steps
        // still resolve; deep-copy so the two slides don't share arrays.
        revealSteps: cloneRevealSteps(orig.revealSteps),
      };
      const slides = [...p.slides];
      slides.splice(idx + 1, 0, copy);
      return { ...p, slides, currentSlideId: copy.id };
    });
  }, [update, setVideoUrl, revokeVideoUrls]);

  const updateSlideExcalidraw = useCallback((slideId: string, data: ExcalidrawData) => {
    update((p) => ({
      ...p,
      slides: p.slides.map((s) =>
        s.id === slideId ? { ...s, excalidrawData: data } : s
      ),
    }));
  }, [update]);

  // Steps are stored as given; empty input clears the field rather than
  // persisting an empty array, keeping decks without reveals unchanged on disk.
  const updateSlideRevealSteps = useCallback((slideId: string, steps: readonly (readonly string[])[]) => {
    update((p) => ({
      ...p,
      slides: p.slides.map((s) =>
        s.id === slideId
          ? { ...s, revealSteps: steps.length > 0 ? steps.map((g) => [...g]) : undefined }
          : s
      ),
    }));
  }, [update]);

  const updateSlideFrame = useCallback((slideId: string, bounds: FrameBounds) => {
    update((p) => ({
      ...p,
      slides: p.slides.map((s) =>
        s.id === slideId ? { ...s, presentationFrame: bounds } : s
      ),
    }));
  }, [update]);

  const updateAllSlidesBackground = useCallback((color: string) => {
    update((p) => ({
      ...p,
      slides: p.slides.map((s) => ({
        ...s,
        excalidrawData: {
          ...s.excalidrawData,
          appState: { ...s.excalidrawData.appState, viewBackgroundColor: color },
        },
      })),
    }));
  }, [update]);

  const updateSlideNotes = useCallback((slideId: string, notes: string) => {
    update((p) => ({
      ...p,
      slides: p.slides.map((s) => (s.id === slideId ? { ...s, notes } : s)),
    }));
  }, [update]);

  const updateSlideNotesDrawing = useCallback((slideId: string, data: ExcalidrawData) => {
    update((p) => ({
      ...p,
      slides: p.slides.map((s) => (s.id === slideId ? { ...s, notesDrawing: data } : s)),
    }));
  }, [update]);

  const updateTitle = useCallback((title: string) => {
    update((p) => ({ ...p, title }));
  }, [update]);

  const addVideoBlock = useCallback(async (file: File): Promise<void> => {
    // Capture the target slide now, since currentSlideId may change during
    // the write and the user picked the file for *this* slide.
    const targetSlideId = presentationRef.current.currentSlideId;
    const block: VideoBlock = {
      id: generateId(),
      name: file.name,
      src: "",
      fileName: file.name,
      mimeType: file.type,
      x: 0.05,
      y: 0.1,
      width: 0.4,
      height: 0.35,
      objectFit: "contain",
      autoplay: false,
      loop: false,
      muted: false,
    };

    // Save the original File to IndexedDB first. Files are disk-backed
    // handles, so the video's bytes are never materialized in JS.
    try {
      await saveVideoBlob(block.id, file);
    } catch {
      setSaveStatus("error");
      return;
    }

    const rollback = async () => {
      revokeVideoUrls([block.id]);
      await deleteVideo(block.id).catch(() => {});
    };

    // The target slide may have been deleted while the file was being written.
    const current = presentationRef.current;
    if (!current.slides.some((s) => s.id === targetSlideId)) {
      await rollback();
      return;
    }
    block.src = setVideoUrl(block.id, file);

    // Verify the stripped metadata still fits in localStorage.
    const candidate: Presentation = {
      ...current,
      slides: current.slides.map((s) =>
        s.id === targetSlideId
          ? { ...s, videoBlocks: [...s.videoBlocks, block] }
          : s
      ),
      updatedAt: Date.now(),
    };
    try {
      savePresentation(
        canStripVideoSrcsRef.current ? stripVideoSrcs(candidate) : stripRuntimeVideoSrcs(candidate)
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        await rollback();
        setSaveStatus("error");
        return;
      }
      throw e;
    }

    update((p) => ({
      ...p,
      slides: p.slides.map((s) =>
        s.id === targetSlideId
          ? { ...s, videoBlocks: [...s.videoBlocks, block] }
          : s
      ),
    }));
  }, [update, setVideoUrl, revokeVideoUrls]);

  // Fills an existing (e.g. empty template) video block in place with a newly
  // chosen file, keeping its position/size/settings instead of creating a new block.
  const setVideoBlockFile = useCallback(async (id: string, file: File): Promise<void> => {
    markVideosMutated([id]); // hydration must not write back a stale payload
    try {
      await saveVideoBlob(id, file); // overwrites any previous record in place
    } catch {
      setSaveStatus("error");
      return;
    }
    // The block may have been deleted (or its slide removed) while the file
    // was being written; don't resurrect the record.
    const stillExists = presentationRef.current.slides.some((s) =>
      s.videoBlocks.some((v) => v.id === id)
    );
    if (!stillExists) {
      revokeVideoUrls([id]);
      await deleteVideo(id).catch(() => {});
      return;
    }
    const src = setVideoUrl(id, file); // revokes the replaced block's old URL
    // Block ids are globally unique, so update by id everywhere rather than
    // via currentSlideId, which may have changed during the await.
    update((p) => ({
      ...p,
      slides: p.slides.map((s) => ({
        ...s,
        videoBlocks: s.videoBlocks.map((v) =>
          v.id === id ? { ...v, src, name: file.name, fileName: file.name, mimeType: file.type } : v
        ),
      })),
    }));
  }, [update, setVideoUrl, revokeVideoUrls, markVideosMutated]);

  const toggleTemplate = useCallback(() => {
    update((p) => ({ ...p, isTemplate: !p.isTemplate }));
  }, [update]);

  const updateVideoBlock = useCallback((id: string, patch: Partial<VideoBlock>) => {
    update((p) => ({
      ...p,
      slides: p.slides.map((s) =>
        s.id === p.currentSlideId
          ? { ...s, videoBlocks: s.videoBlocks.map((v) => (v.id === id ? { ...v, ...patch } : v)) }
          : s
      ),
    }));
  }, [update]);

  const clearSaveError = useCallback(() => setSaveStatus("idle"), []);

  const flushSave = useCallback((): boolean => {
    try {
      const current = presentationRef.current;
      savePresentation(
        canStripVideoSrcsRef.current ? stripVideoSrcs(current) : stripRuntimeVideoSrcs(current)
      );
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        setSaveStatus("error");
      }
      return false;
    }
  }, []);

  // Returns an error string on failure, null on success.
  // Atomic: every imported Blob is saved and the stripped metadata is
  // preflighted before state is replaced; the old deck's records and URLs are
  // only removed after the commit. On failure, newly written Blobs and
  // created URLs are rolled back.
  const replacePresentation = useCallback(async (parsed: ParsedPresentationBundle): Promise<string | null> => {
    const validated = validatePresentation(parsed.presentation);
    if (!validated) return "File is not a valid presentation backup.";
    const { presentation: rekeyed, videoIdPairs } = rekeyImportedPresentation(migratePresentation(validated));

    const savedIds: string[] = [];
    const newUrls = new Map<string, string>();
    const rollback = async () => {
      revokeVideoUrls([...newUrls.keys()]);
      await Promise.all(savedIds.map((vid) => deleteVideo(vid).catch(() => {})));
    };

    try {
      for (const { oldId, newId } of videoIdPairs) {
        const blob = parsed.videoBlobs.get(oldId);
        if (!blob) continue; // no stored payload, degrades to "Video missing"
        await saveVideoBlob(newId, blob);
        savedIds.push(newId);
        newUrls.set(newId, setVideoUrl(newId, blob));
      }
    } catch {
      await rollback();
      return "Failed to save video data. Please try again.";
    }

    const next: Presentation = {
      ...rekeyed,
      slides: rekeyed.slides.map((s) => ({
        ...s,
        videoBlocks: s.videoBlocks.map((b) => ({ ...b, src: newUrls.get(b.id) ?? "" })),
      })),
      id: presentationRef.current.id,
      updatedAt: Date.now(),
    };

    // Preflight: the stripped metadata must fit in localStorage before the
    // in-memory deck is replaced.
    try {
      savePresentation(stripVideoSrcs(next));
    } catch {
      await rollback();
      return "Not enough browser storage to import this presentation.";
    }

    // Commit, then clean up the replaced deck's stored videos and URLs.
    // Marking the removed ids stops a still-running hydration pass from
    // resurrecting their records or minting orphan URLs. (Before this point
    // the old deck was still live, so hydration was allowed to touch it.)
    const removedIds = videoIds(presentationRef.current);
    markVideosMutated(removedIds);
    setSaveStatus("saving");
    canStripVideoSrcsRef.current = true;
    setPresentation(next);
    revokeVideoUrls(removedIds);
    deleteVideosBestEffort(removedIds);
    return null;
  }, [setVideoUrl, revokeVideoUrls, markVideosMutated]);

  // Returns an error string on failure, null on success.
  const importFromExcalidraw = useCallback((fileName: string, rawJson: unknown): string | null => {
    const result = parseExcalidrawFile(fileName, rawJson);
    if (typeof result === "string") return result;
    const removedIds = videoIds(presentationRef.current);
    markVideosMutated(removedIds);
    revokeVideoUrls(removedIds);
    deleteVideosBestEffort(removedIds);
    setSaveStatus("saving");
    canStripVideoSrcsRef.current = true;
    setPresentation({ ...result, id: presentationRef.current.id, updatedAt: Date.now() });
    return null;
  }, [revokeVideoUrls, markVideosMutated]);

  const deleteVideoBlock = useCallback((id: string) => {
    markVideosMutated([id]);
    revokeVideoUrls([id]);
    deleteVideosBestEffort([id]);
    update((p) => ({
      ...p,
      slides: p.slides.map((s) =>
        s.id === p.currentSlideId
          ? { ...s, videoBlocks: s.videoBlocks.filter((v) => v.id !== id) }
          : s
      ),
    }));
  }, [update, revokeVideoUrls, markVideosMutated]);

  return {
    presentation,
    saveStatus,
    isHydrated,
    selectSlide,
    addSlide,
    addSlideWithElements,
    deleteSlide,
    renameSlide,
    moveSlide,
    updateSlideExcalidraw,
    reorderSlide,
    duplicateSlide,
    updateSlideFrame,
    updateSlideRevealSteps,
    updateAllSlidesBackground,
    updateSlideNotes,
    updateSlideNotesDrawing,
    updateTitle,
    addVideoBlock,
    updateVideoBlock,
    setVideoBlockFile,
    deleteVideoBlock,
    toggleTemplate,
    clearSaveError,
    flushSave,
    replacePresentation,
    importFromExcalidraw,
  };
}
