import { useState, useRef, useCallback, useEffect } from "react";
import type { AppMode } from "./types/presentation";
import type { ExcalidrawImperativeAPI, LibraryItems } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { loadLibraryFromBlob, mergeLibraryItems } from "@excalidraw/excalidraw";
import { usePresentation } from "./hooks/usePresentation";
import { useStorageHealth } from "./hooks/useStorageHealth";
import { downloadPresentationBundle, parsePresentationBundle } from "./lib/presentationBundle";
import { loadLibrary, saveLibrary, clearLibrary } from "./lib/libraryStorage";
import type { ParsedCommand } from "./lib/commandParser";
import { centerElementsOnFrame } from "./lib/mermaidImport";
import { extractFrameBounds, PRESENTATION_FRAME, withoutPresentationFrameGuide } from "./lib/presentationFrame";
import TopBar from "./components/TopBar";
import SlideSidebar from "./components/SlideSidebar";
import EditorCanvas from "./components/EditorCanvas";
import RightPanel from "./components/RightPanel";
import PresentationView from "./components/PresentationView";
import HelpOverlay from "./components/HelpOverlay";
import SaveErrorToast from "./components/SaveErrorToast";
import CommandBar from "./components/CommandBar";
import MermaidImportDialog from "./components/MermaidImportDialog";
import { appendRevealStep, resolveRevealSteps } from "./lib/revealSteps";
import type { MermaidInsertTarget } from "./components/MermaidImportDialog";

type Props = {
  presentationId: string;
  onHome: () => void;
};

// Stable identity so a slide change doesn't hand the panel a fresh empty array.
const NO_SELECTION: string[] = [];

export default function EditorApp({ presentationId, onHome }: Props) {
  const [mode, setMode] = useState<AppMode>("editor");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [cmdBarOpen, setCmdBarOpen] = useState(false);
  const [showMermaidDialog, setShowMermaidDialog] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [selection, setSelection] = useState<{ slideId: string; ids: string[] }>({
    slideId: "",
    ids: NO_SELECTION,
  });
  const [libraryItems, setLibraryItems] = useState<LibraryItems>(() => loadLibrary());
  const [isExporting, setIsExporting] = useState(false);
  const [isAddingVideo, setIsAddingVideo] = useState(false);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const libraryPersistWarnedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importBundleRef = useRef<HTMLInputElement>(null);
  const importExcalidrawRef = useRef<HTMLInputElement>(null);
  const importLibraryRef = useRef<HTMLInputElement>(null);
  const fillFileInputRef = useRef<HTMLInputElement>(null);
  const fillTargetIdRef = useRef<string | null>(null);

  const {
    presentation,
    saveStatus,
    isHydrated,
    selectSlide,
    addSlide,
    addSlideWithElements,
    reorderSlide,
    duplicateSlide,
    deleteSlide,
    renameSlide,
    moveSlide,
    updateSlideExcalidraw,
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
  } = usePresentation(presentationId);

  const { estimate: storageEstimate, level: storageLevel } = useStorageHealth();

  const currentSlide = presentation.slides.find(
    (s) => s.id === presentation.currentSlideId
  );
  const selectedVideo = currentSlide?.videoBlocks.find(
    (v) => v.id === selectedVideoId
  );

  // Warn before the tab closes/refreshes/navigates away if the current state
  // can't actually be persisted (e.g. localStorage quota exceeded), the same
  // check handleHome uses below. Relies on a fresh flushSave() call rather
  // than saveStatus, which can be stale.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!flushSave()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flushSave]);

  const handleSelectSlide = useCallback((id: string) => {
    selectSlide(id);
    setSelectedVideoId(null);
  }, [selectSlide]);

  // Open the editor command bar on /, mirroring the presenter shortcut with
  // the same modifier and text-field guards so typing is never hijacked.
  const hasCurrentSlide = !!currentSlide;
  useEffect(() => {
    if (mode !== "editor") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (cmdBarOpen || showMermaidDialog || showHelp || !hasCurrentSlide) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) return;
      e.preventDefault();
      setCmdBarOpen(true);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [mode, cmdBarOpen, showMermaidDialog, showHelp, hasCurrentSlide]);

  const handleEditorCommand = useCallback((cmd: ParsedCommand) => {
    setCmdBarOpen(false);
    if (cmd.type === "mermaid") {
      setShowMermaidDialog(true);
      return;
    }
    if (cmd.type === "reveal") {
      // Read the live canvas rather than the debounced selection state: the
      // command bar takes focus, and a shape drawn moments ago may not have
      // been reported yet.
      const api = excalidrawApiRef.current;
      const slide = presentation.slides.find((s) => s.id === presentation.currentSlideId);
      if (!api || !slide) return;
      const appState = api.getAppState();
      const ids = api
        .getSceneElements()
        .filter((el) => !el.isDeleted && appState.selectedElementIds[el.id])
        .map((el) => el.id);
      if (ids.length === 0) return;
      updateSlideRevealSteps(
        slide.id,
        appendRevealStep(resolveRevealSteps(slide.excalidrawData.elements, slide.revealSteps), ids),
      );
    }
  }, [presentation, updateSlideRevealSteps]);

  // Selection is tagged with the slide it came from and discarded on render
  // when the slide changes, so the reveal panel can never act on another
  // slide's element ids.
  const selectedElementIds =
    selection.slideId === presentation.currentSlideId ? selection.ids : NO_SELECTION;

  const handleCanvasSelectionChange = useCallback((ids: string[]) => {
    setSelection({ slideId: presentation.currentSlideId, ids });
  }, [presentation.currentSlideId]);

  const handleRevealStepsChange = useCallback((steps: string[][]) => {
    updateSlideRevealSteps(presentation.currentSlideId, steps);
  }, [updateSlideRevealSteps, presentation.currentSlideId]);

  const handleSelectElements = useCallback((ids: string[]) => {
    excalidrawApiRef.current?.updateScene({
      appState: { selectedElementIds: Object.fromEntries(ids.map((id) => [id, true as const])) },
    });
  }, []);

  const handleMermaidInsert = useCallback((elements: readonly ExcalidrawElement[], target: MermaidInsertTarget) => {
    const slide = presentation.slides.find((s) => s.id === presentation.currentSlideId);
    if (!slide) return;

    if (target === "new") {
      const frame = slide.presentationFrame ?? PRESENTATION_FRAME;
      addSlideWithElements(centerElementsOnFrame(elements, frame));
      setShowMermaidDialog(false);
      return;
    }

    const api = excalidrawApiRef.current;
    if (api) {
      // Merge with the live scene (not the debounced React copy) so edits
      // still inside Excalidraw's onChange debounce cannot be lost. The live
      // guide position wins over the persisted one for the same reason.
      const scene = api.getSceneElements();
      const frame = extractFrameBounds(scene) ?? slide.presentationFrame ?? PRESENTATION_FRAME;
      const placed = centerElementsOnFrame(elements, frame);
      const merged = [...scene, ...placed];
      // Commit through React state now: Home, Present, and Export read that
      // state, and waiting for the canvas's 150 ms onChange debounce would
      // let an immediate navigation or export drop the diagram.
      updateSlideExcalidraw(slide.id, {
        elements: withoutPresentationFrameGuide(merged),
        appState: { ...slide.excalidrawData.appState },
        files: api.getFiles(),
      });
      api.updateScene({
        elements: merged,
        appState: {
          selectedElementIds: Object.fromEntries(placed.map((el) => [el.id, true as const])),
        },
      });
    } else {
      // Canvas not mounted: merge into persisted data and remount.
      const frame = slide.presentationFrame ?? PRESENTATION_FRAME;
      const placed = centerElementsOnFrame(elements, frame);
      updateSlideExcalidraw(slide.id, {
        ...slide.excalidrawData,
        elements: [...slide.excalidrawData.elements, ...placed],
      });
      setEditorResetKey((key) => key + 1);
    }
    setShowMermaidDialog(false);
  }, [presentation, addSlideWithElements, updateSlideExcalidraw]);

  const handleBackgroundColorChange = useCallback((color: string) => {
    updateAllSlidesBackground(color);
  }, [updateAllSlidesBackground]);

  const handleDeleteVideo = useCallback((id: string) => {
    deleteVideoBlock(id);
    if (selectedVideoId === id) setSelectedVideoId(null);
  }, [deleteVideoBlock, selectedVideoId]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setIsAddingVideo(true);
    try {
      await addVideoBlock(file);
    } finally {
      setIsAddingVideo(false);
    }
  };

  const handleFillVideo = useCallback((id: string) => {
    if (isAddingVideo) return;
    fillTargetIdRef.current = id;
    fillFileInputRef.current?.click();
  }, [isAddingVideo]);

  const handleFillFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const id = fillTargetIdRef.current;
    e.target.value = "";
    fillTargetIdRef.current = null;
    if (!file || !id) return;
    setIsAddingVideo(true);
    try {
      await setVideoBlockFile(id, file);
    } finally {
      setIsAddingVideo(false);
    }
  };

  const handleExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await downloadPresentationBundle(presentation);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not build the presentation bundle.");
    } finally {
      setIsExporting(false);
    }
  }, [presentation, isExporting]);

  const handleHome = useCallback(() => {
    if (flushSave()) onHome();
  }, [flushSave, onHome]);

  const handleImportBundleChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!window.confirm("This will replace your current presentation. Continue?")) return;
    // The File is handed to the parser as-is; it is streamed, never read into
    // memory as a whole.
    const parsed = await parsePresentationBundle(file);
    if (typeof parsed === "string") {
      alert(parsed);
      return;
    }
    const err = await replacePresentation(parsed);
    if (err) alert(err);
    else setEditorResetKey((key) => key + 1);
  }, [replacePresentation]);

  const handleImportExcalidrawChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!window.confirm("This will replace your current presentation with slides from the Excalidraw file. Continue?")) return;
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      alert("Could not read file — make sure it's a valid .excalidraw or JSON file.");
      return;
    }
    const err = importFromExcalidraw(file.name, raw);
    if (err) alert(err);
    else setEditorResetKey((key) => key + 1);
  }, [importFromExcalidraw]);

  const handleImportLibraryChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let incoming: LibraryItems;
    try {
      incoming = await loadLibraryFromBlob(file);
    } catch {
      alert("Could not read file — make sure it's a valid .excalidrawlib file.");
      return;
    }
    const merged = mergeLibraryItems(libraryItems, incoming);
    try {
      saveLibrary(merged);
    } catch {
      alert("Library installed for this session but could not be persisted — storage may be full.");
    }
    try {
      await excalidrawApiRef.current?.updateLibrary({ libraryItems: merged, merge: false });
    } catch {
      // Storage is already updated; canvas may lag until next slide mount.
    }
    setLibraryItems(merged);
  }, [libraryItems]);

  const handleLibraryChange = useCallback((items: LibraryItems) => {
    try {
      if (items.length === 0) {
        clearLibrary();
      } else {
        saveLibrary(items);
      }
      libraryPersistWarnedRef.current = false;
    } catch {
      if (!libraryPersistWarnedRef.current) {
        libraryPersistWarnedRef.current = true;
        alert("Library changes could not be saved to storage — they will be lost on reload.");
      }
    }
    setLibraryItems(items);
  }, []);

  const handleClearLibrary = useCallback(async () => {
    if (!window.confirm(`Remove all ${libraryItems.length} library items?`)) return;
    clearLibrary();
    try {
      await excalidrawApiRef.current?.updateLibrary({ libraryItems: [], merge: false });
    } catch {
      // Canvas may show stale items until next slide mount or reload.
    }
    setLibraryItems([]);
  }, [libraryItems.length]);

  const handlePresent = () => {
    if (presentation.slides.length === 0) return;
    document.documentElement.requestFullscreen?.().catch(() => {});
    setMode("present");
  };

  const handleExitPresent = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setMode("editor");
  };

  if (mode === "present") {
    return (
      <PresentationView
        presentationId={presentation.id}
        slides={presentation.slides}
        currentSlideId={presentation.currentSlideId}
        onSelectSlide={handleSelectSlide}
        onExit={handleExitPresent}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen bg-stone-50 text-stone-900 overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/webm,video/mp4,video/quicktime"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={importBundleRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={handleImportBundleChange}
      />
      <input
        ref={importExcalidrawRef}
        type="file"
        accept=".excalidraw,.json,application/json"
        className="hidden"
        onChange={handleImportExcalidrawChange}
      />
      <input
        ref={importLibraryRef}
        type="file"
        accept=".excalidrawlib"
        className="hidden"
        onChange={handleImportLibraryChange}
      />
      <input
        ref={fillFileInputRef}
        type="file"
        accept="video/webm,video/mp4,video/quicktime"
        className="hidden"
        onChange={handleFillFileChange}
      />
      <TopBar
        presentation={presentation}
        saveStatus={saveStatus}
        isHydrated={isHydrated}
        isExporting={isExporting}
        isAddingVideo={isAddingVideo}
        storageEstimate={storageEstimate}
        storageLevel={storageLevel}
        slideBackgroundColor={currentSlide?.excalidrawData.appState.viewBackgroundColor}
        onHome={handleHome}
        onPresent={handlePresent}
        onTitleChange={updateTitle}
        onBackgroundColorChange={handleBackgroundColorChange}
        onAddVideo={() => fileInputRef.current?.click()}
        onExport={handleExport}
        onImport={() => importBundleRef.current?.click()}
        onImportExcalidraw={() => importExcalidrawRef.current?.click()}
        // Deferred: this fires from a Radix DropdownMenuItem (TopBar's "More
        // options" menu). Opening the Dialog synchronously races the
        // DropdownMenu's own close/focus-restore cleanup — both are
        // DismissableLayer-based and, closing and opening in the same tick,
        // can leave `document.body` stuck at `pointer-events: none`. A
        // zero-delay timeout lets the menu finish closing first.
        onInsertMermaid={() => setTimeout(() => setShowMermaidDialog(true), 0)}
        onImportLibrary={() => importLibraryRef.current?.click()}
        onClearLibrary={handleClearLibrary}
        libraryItemCount={libraryItems.length}
        onToggleTemplate={toggleTemplate}
        onHelp={() => setShowHelp(true)}
      />
      <div className="flex flex-1 overflow-hidden">
        <SlideSidebar
          presentation={presentation}
          onSelectSlide={handleSelectSlide}
          onAddSlide={addSlide}
          onDuplicateSlide={duplicateSlide}
          onDeleteSlide={deleteSlide}
          onRenameSlide={renameSlide}
          onMoveSlide={moveSlide}
          onReorderSlide={reorderSlide}
        />
        <EditorCanvas
          key={`${presentation.id}:${editorResetKey}`}
          slide={currentSlide}
          selectedVideoId={selectedVideoId}
          onExcalidrawChange={updateSlideExcalidraw}
          onFrameChange={updateSlideFrame}
          onSelectVideo={setSelectedVideoId}
          onUpdateVideo={updateVideoBlock}
          onDeleteVideo={handleDeleteVideo}
          onFillVideo={handleFillVideo}
          isAddingVideo={isAddingVideo}
          onDeselectVideo={() => setSelectedVideoId(null)}
          libraryItems={libraryItems}
          onLibraryChange={handleLibraryChange}
          onApiReady={(api) => { excalidrawApiRef.current = api; }}
          onSelectionChange={handleCanvasSelectionChange}
        />
        <RightPanel
          slide={currentSlide}
          selectedVideo={selectedVideo}
          selectedElementIds={selectedElementIds}
          onNotesChange={(notes) => updateSlideNotes(presentation.currentSlideId, notes)}
          onNotesDrawingChange={(data) => updateSlideNotesDrawing(presentation.currentSlideId, data)}
          onRevealStepsChange={handleRevealStepsChange}
          onSelectElements={handleSelectElements}
          onUpdateVideo={(patch) => selectedVideoId && updateVideoBlock(selectedVideoId, patch)}
          onDeleteVideo={() => selectedVideoId && handleDeleteVideo(selectedVideoId)}
        />
      </div>
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      {cmdBarOpen && (
        <CommandBar
          context="editor"
          onExecute={handleEditorCommand}
          onClose={() => setCmdBarOpen(false)}
        />
      )}
      {showMermaidDialog && (
        <MermaidImportDialog
          onInsert={handleMermaidInsert}
          onClose={() => setShowMermaidDialog(false)}
        />
      )}
      {saveStatus === "error" && (
        <SaveErrorToast
          onDismiss={clearSaveError}
          onPickFile={() => { clearSaveError(); fileInputRef.current?.click(); }}
        />
      )}
    </div>
  );
}
