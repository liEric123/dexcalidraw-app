import { useEffect, useRef, useCallback, useState } from "react";
import { Excalidraw, newElementWith } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, LibraryItems } from "@excalidraw/excalidraw/types";
import type { Slide, ExcalidrawData, FrameBounds } from "../types/presentation";
import {
  createPresentationFrameGuide,
  PRESENTATION_FRAME,
  PRESENTATION_FRAME_ID,
  withoutPresentationFrameGuide,
} from "../lib/presentationFrame";
import { stepFontSize } from "../lib/fontSizes";

type Props = {
  slide: Slide;
  viewMode?: boolean;
  onChange?: (data: ExcalidrawData) => void;
  onApiReady?: (api: ExcalidrawImperativeAPI) => void;
  onFrameChange?: (bounds: FrameBounds) => void;
  /** Live canvas selection, for editor UI that acts on selected elements. */
  onSelectionChange?: (ids: string[]) => void;
  libraryItems?: LibraryItems;
  onLibraryChange?: (items: LibraryItems) => void;
};

export default function ExcalidrawSlideCanvas({ slide, viewMode = false, onChange, onApiReady, onFrameChange, onSelectionChange, libraryItems, onLibraryChange }: Props) {
  const pendingRef = useRef<ExcalidrawData | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const prevFrameRef = useRef<FrameBounds | null>(null);
  const onFrameChangeRef = useRef(onFrameChange);
  useEffect(() => { onFrameChangeRef.current = onFrameChange; }, [onFrameChange]);
  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);
  // Excalidraw reports selection on every pointer interaction; only forward
  // genuine changes so hovering and panning don't re-render the editor shell.
  const lastSelectionRef = useRef<string>("");

  // Fingerprint of the last content we actually emitted, to skip onChange
  // calls that only carry UI state (tool selection, cursor, viewport pan/zoom,
  // selectedElementIds, etc.) with no real content change.
  // Seeded from the slide's persisted data so Excalidraw's initial onChange on
  // mount (which returns the same elements) is also filtered out.
  const lastVersionSumRef = useRef<number>(
    slide.excalidrawData.elements.reduce((s, e) => (!e.isDeleted ? s + e.version : s), 0)
  );
  const lastFileKeyCountRef = useRef<number>(Object.keys(slide.excalidrawData.files).length);

  // [ and ] step font size down/up on selected text elements.
  useEffect(() => {
    if (viewMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "[" && e.key !== "]") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (!apiRef.current) return;
      const appState = apiRef.current.getAppState();
      const elements = apiRef.current.getSceneElements();
      const hasSelectedText = elements.some(
        (el) => el.type === "text" && appState.selectedElementIds[el.id] && !el.isDeleted
      );
      if (!hasSelectedText) return;
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === "]" ? 1 : -1;
      const updated = elements.map((el) => {
        if (el.type !== "text" || !appState.selectedElementIds[el.id] || el.isDeleted) return el;
        // newElementWith updates Excalidraw's version metadata so the change is persisted.
        return newElementWith(el as ExcalidrawTextElement, {
          fontSize: stepFontSize((el as ExcalidrawTextElement).fontSize, dir),
        });
      });
      apiRef.current.updateScene({ elements: updated as ExcalidrawElement[] });
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [viewMode]);

  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      if (viewMode) return;

      if (onSelectionChangeRef.current) {
        const selected = elements
          .filter(
            (el) =>
              !el.isDeleted &&
              el.id !== PRESENTATION_FRAME_ID &&
              appState.selectedElementIds[el.id],
          )
          .map((el) => el.id)
          .sort();
        const key = selected.join(",");
        if (key !== lastSelectionRef.current) {
          lastSelectionRef.current = key;
          onSelectionChangeRef.current(selected);
        }
      }

      if (!onChange) return;

      // Detect frame guide movement/resize and enforce 16:9 aspect ratio.
      const frameEl = elements.find((el) => el.id === PRESENTATION_FRAME_ID && !el.isDeleted);
      if (frameEl && apiRef.current) {
        const expectedHeight = frameEl.width * (9 / 16);
        if (Math.abs(frameEl.height - expectedHeight) > 0.5) {
          // Snap height to 16:9 and let the corrected onChange propagate naturally.
          const corrected = { ...frameEl, height: expectedHeight } as ExcalidrawElement;
          apiRef.current.updateScene({
            elements: elements.map((el) =>
              el.id === PRESENTATION_FRAME_ID ? corrected : el
            ) as ExcalidrawElement[],
          });
          return;
        }

        const prev = prevFrameRef.current;
        const { x, y, width, height } = frameEl;
        if (!prev || x !== prev.x || y !== prev.y || width !== prev.width || height !== prev.height) {
          const bounds: FrameBounds = { x, y, width, height };
          prevFrameRef.current = bounds;
          onFrameChangeRef.current?.(bounds);
        }
      }

      // Skip if only UI state changed (selection, tool, cursor, viewport…).
      // Element versions increment on any content edit; file key count grows when
      // images are embedded. Neither changes for pure UI interactions.
      const versionSum = elements.reduce(
        (s, e) => (e.id !== PRESENTATION_FRAME_ID && !e.isDeleted ? s + e.version : s),
        0,
      );
      const fileKeyCount = Object.keys(files).length;
      if (versionSum === lastVersionSumRef.current && fileKeyCount === lastFileKeyCountRef.current) return;
      lastVersionSumRef.current = versionSum;
      lastFileKeyCountRef.current = fileKeyCount;

      pendingRef.current = { elements: withoutPresentationFrameGuide(elements), appState, files };
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (pendingRef.current) onChange(pendingRef.current);
      }, 150);
    },
    [viewMode, onChange]
  );

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  // Sync background color changes made outside of Excalidraw (e.g. RightPanel picker).
  const backgroundColor = slide.excalidrawData.appState.viewBackgroundColor;
  useEffect(() => {
    if (!apiRef.current || !backgroundColor) return;
    apiRef.current.updateScene({ appState: { viewBackgroundColor: backgroundColor } as AppState });
  }, [backgroundColor]);

  // After the API is ready, fit the editor/presenter to the relevant content.
  useEffect(() => {
    if (!api) return;
    if (!viewMode) {
      const timer = setTimeout(() => {
        const guide = api.getSceneElements().find((el) => el.id === PRESENTATION_FRAME_ID) ??
          createPresentationFrameGuide(true, slide.presentationFrame ?? PRESENTATION_FRAME);
        api.scrollToContent([guide], { fitToViewport: true, viewportZoomFactor: 1 });
      }, 0);
      return () => clearTimeout(timer);
    }
    const elements = api.getSceneElements();
    if (elements.length > 0) {
      api.scrollToContent(elements, { fitToViewport: true });
    }
  }, [api, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const frameBounds = slide.presentationFrame ?? PRESENTATION_FRAME;

  const initData = viewMode
    ? {
        elements: slide.excalidrawData.elements,
        appState: {
          viewBackgroundColor: slide.excalidrawData.appState.viewBackgroundColor,
        },
        files: slide.excalidrawData.files,
        scrollToContent: true,
      }
    : {
        elements: [
          createPresentationFrameGuide(true, frameBounds),
          ...withoutPresentationFrameGuide(slide.excalidrawData.elements),
        ],
        appState: { ...slide.excalidrawData.appState, collaborators: new Map() },
        files: slide.excalidrawData.files,
        libraryItems,
      };

  return (
    <div className="w-full h-full">
      <Excalidraw
        key={slide.id}
        excalidrawAPI={(a: ExcalidrawImperativeAPI) => { apiRef.current = a; setApi(a); onApiReady?.(a); }}
        initialData={initData}
        onChange={handleChange}
        viewModeEnabled={viewMode}
        theme="light"
        onLibraryChange={onLibraryChange}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: false,
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: false,
            saveAsImage: false,
          },
        }}
      />
    </div>
  );
}
