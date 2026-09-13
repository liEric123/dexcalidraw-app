import { useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Slide, ExcalidrawData } from "../types/presentation";
import {
  createPresentationFrameGuide,
  PRESENTATION_FRAME,
  withoutPresentationFrameGuide,
} from "../lib/presentationFrame";
import { applyRevealOpacity, hiddenElementIds } from "../lib/revealSteps";

type Props = {
  slide: Slide;
  /** Reveal stop to render: 0 shows the base layer only. */
  revealStep: number;
  inkMode: boolean;
  inkHighlight: boolean;
  inkColor: string;
  inkStrokeWidth: number;
  initialInk: ExcalidrawData | undefined;
  onInkCommit: (elements: readonly ExcalidrawElement[]) => void;
  onApiReady: (api: ExcalidrawImperativeAPI) => void;
  // Reports Excalidraw's actual "tool:strokeWidth:opacity" state. setActiveTool and
  // updateScene commit asynchronously inside Excalidraw, so this is the only
  // reliable "ink is ready to draw with these settings" signal.
  onInkStateChange: (state: string) => void;
};

// Highlighter strokes are translucent and much wider than pen strokes at the same width preset.
const HIGHLIGHT_OPACITY = 50;
const HIGHLIGHT_WIDTH_FACTOR = 4;

export default function PresentationCanvas({
  slide,
  revealStep,
  inkMode,
  inkHighlight,
  inkColor,
  inkStrokeWidth,
  initialInk,
  onInkCommit,
  onApiReady,
  onInkStateChange,
}: Props) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // IDs of the slide's own elements; anything else is ink.
  const slideIdsRef = useRef<ReadonlySet<string>>(
    new Set(withoutPresentationFrameGuide(slide.excalidrawData.elements).map((e) => e.id))
  );
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inkModeRef = useRef(inkMode);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onInkCommitRef = useRef(onInkCommit);
  const onInkStateChangeRef = useRef(onInkStateChange);
  useEffect(() => { onInkCommitRef.current = onInkCommit; }, [onInkCommit]);
  useEffect(() => { onInkStateChangeRef.current = onInkStateChange; }, [onInkStateChange]);
  useEffect(() => { inkModeRef.current = inkMode; }, [inkMode]);

  // Activate freedraw after Excalidraw has applied viewModeEnabled={false}, but
  // before the browser can deliver the presenter's next pointer gesture.
  // setActiveTool also applies Excalidraw's cursor, selection, and history side effects.
  useLayoutEffect(() => {
    if (!inkMode || !apiRef.current) return;
    apiRef.current.setActiveTool({ type: "freedraw" });
    apiRef.current.updateScene({
      appState: {
        currentItemStrokeColor: inkColor,
        currentItemStrokeWidth: inkHighlight ? inkStrokeWidth * HIGHLIGHT_WIDTH_FACTOR : inkStrokeWidth,
        currentItemBackgroundColor: "transparent",
        currentItemRoughness: 0,
        currentItemOpacity: inkHighlight ? HIGHLIGHT_OPACITY : 100,
      } as AppState,
    });
  }, [inkMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetStrokeWidth = inkHighlight ? inkStrokeWidth * HIGHLIGHT_WIDTH_FACTOR : inkStrokeWidth;
  const targetOpacity = inkHighlight ? HIGHLIGHT_OPACITY : 100;

  // Excalidraw's own view-mode transition can asynchronously undo setActiveTool
  // and reset the currentItem settings, leaving the presenter drawing with the
  // wrong tool or stroke style. Verify the full contract via the imperative API
  // and re-issue it until it holds for several consecutive ticks, reporting the
  // actual tool so tests can wait on it.
  useEffect(() => {
    if (!inkMode) return;
    let attempts = 0;
    let stableTicks = 0;
    const id = setInterval(() => {
      const api = apiRef.current;
      if (!api) return;
      const s = api.getAppState();
      onInkStateChangeRef.current(
        `${s.activeTool.type}:${s.currentItemStrokeWidth}:${s.currentItemOpacity}`
      );
      const applied =
        s.activeTool.type === "freedraw" &&
        s.currentItemStrokeColor === inkColor &&
        s.currentItemStrokeWidth === targetStrokeWidth &&
        s.currentItemOpacity === targetOpacity;
      if (applied) {
        if (++stableTicks >= 3) clearInterval(id);
        return;
      }
      stableTicks = 0;
      if (++attempts > 40) {
        clearInterval(id);
        return;
      }
      api.setActiveTool({ type: "freedraw" });
      api.updateScene({
        appState: {
          currentItemStrokeColor: inkColor,
          currentItemStrokeWidth: targetStrokeWidth,
          currentItemBackgroundColor: "transparent",
          currentItemRoughness: 0,
          currentItemOpacity: targetOpacity,
        } as AppState,
      });
    }, 50);
    return () => clearInterval(id);
  }, [inkMode, inkColor, targetStrokeWidth, targetOpacity]);

  // Push color/width/highlight changes into the live instance without remounting.
  useEffect(() => {
    if (!inkMode || !apiRef.current) return;
    apiRef.current.updateScene({
      appState: {
        currentItemStrokeColor: inkColor,
        currentItemStrokeWidth: targetStrokeWidth,
        currentItemOpacity: targetOpacity,
      } as AppState,
    });
  }, [inkColor, targetStrokeWidth, targetOpacity, inkMode]);

  // Advancing a reveal step must not remount the canvas: that would discard
  // the presenter's ink and re-run the fit animation mid-slide. Patch opacity
  // on the live scene instead, restoring each element's authored opacity rather
  // than assuming 100. Idempotent, so the mount pass (where initialData already
  // carries the reveal) is a no-op.
  const slideElements = slide.excalidrawData.elements;
  const revealSteps = slide.revealSteps;
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const base = withoutPresentationFrameGuide(slideElements);
    const hidden = hiddenElementIds(base, revealSteps, revealStep);
    const authoredOpacity = new Map(base.map((el) => [el.id, el.opacity]));
    let changed = false;
    const next = api.getSceneElements().map((el) => {
      const authored = authoredOpacity.get(el.id);
      if (authored === undefined) return el; // presenter ink
      const target = hidden.has(el.id) ? 0 : authored;
      if (el.opacity === target) return el;
      changed = true;
      return { ...el, opacity: target } as ExcalidrawElement;
    });
    if (changed) api.updateScene({ elements: next });
  }, [revealStep, slideElements, revealSteps]);

  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      onInkStateChangeRef.current(
        `${appState.activeTool.type}:${appState.currentItemStrokeWidth}:${appState.currentItemOpacity}`
      );
      if (!inkModeRef.current) return;
      const inkEls = elements.filter(
        (el) => !el.isDeleted && !slideIdsRef.current.has(el.id)
      );
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onInkCommitRef.current(inkEls);
      }, 150);
    },
    [],
  );

  useEffect(() => () => {
    clearTimeout(debounceRef.current);
    clearTimeout(fitTimerRef.current);
  }, []);

  const baseEls = withoutPresentationFrameGuide(slide.excalidrawData.elements);
  // Slide elements are locked so the user can't accidentally move them while drawing.
  const slideEls = applyRevealOpacity(
    baseEls,
    hiddenElementIds(baseEls, slide.revealSteps, revealStep),
  ).map((el) => ({ ...el, locked: true })) as ExcalidrawElement[];
  const inkEls = (initialInk?.elements ?? []) as ExcalidrawElement[];
  const frameBounds = slide.presentationFrame ?? PRESENTATION_FRAME;
  const fitGuide = createPresentationFrameGuide(false, frameBounds);

  const initData = {
    elements: [...slideEls, ...inkEls],
    appState: {
      ...slide.excalidrawData.appState,
      collaborators: new Map(),
    } as Partial<AppState>,
    files: { ...slide.excalidrawData.files, ...(initialInk?.files ?? {}) },
  };

  return (
    <div className="presentation-canvas w-full h-full">
      <Excalidraw
        initialData={initData}
        excalidrawAPI={(api) => {
          apiRef.current = api;
          onApiReady(api);
          clearTimeout(fitTimerRef.current);
          fitTimerRef.current = setTimeout(() => {
            api.scrollToContent([fitGuide], { fitToViewport: true, viewportZoomFactor: 1 });
          }, 0);
        }}
        onChange={handleChange}
        viewModeEnabled={!inkMode}
        theme="light"
      />
    </div>
  );
}
