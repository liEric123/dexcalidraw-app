import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import type { Slide } from "../types/presentation";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import PresentationCanvas from "./PresentationCanvas";
import VideoOverlayLayer from "./VideoOverlayLayer";
import CommandBar from "./CommandBar";
import SlideOverview from "./SlideOverview";
import type { ParsedCommand } from "../lib/commandParser";
import { withoutPresentationFrameGuide } from "../lib/presentationFrame";
import { applyRevealOpacity, hiddenElementIds, revealStepCount } from "../lib/revealSteps";
import { clampToPlayableRange, getTrimBounds, playbackResumeTime } from "../lib/videoPlayback";

type Props = {
  presentationId: string;
  slides: Slide[];
  currentSlideId: string;
  onSelectSlide: (id: string) => void;
  onExit: () => void;
};

const INK_COLORS = [
  { value: "#e11d48", label: "Red" },
  { value: "#f97316", label: "Orange" },
  { value: "#eab308", label: "Yellow" },
  { value: "#22c55e", label: "Green" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#ffffff", label: "White" },
];

const INK_WIDTHS = [1, 2, 4] as const;

// "idle": never opened this session. "open": window is up. "closed": was
// open and the presenter (or the OS) closed it, so the dual-window setup has
// come apart mid-presentation. "blocked": window.open() returned null,
// almost always a popup blocker.
type NotesWindowStatus = "idle" | "open" | "closed" | "blocked";

// Top is larger to cover the toolbar (top-4 = 16px) plus the picker row (~92px).
// Bottom is smaller: a 120px zone at 720px viewport height covers too much slide content.
const TOP_ZONE_PX = 100;
const BOTTOM_ZONE_PX = 80;

export default function PresentationView({ presentationId, slides, currentSlideId, onSelectSlide, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [inkMode, setInkMode] = useState(false);
  // Highlighter is pen mode with translucent, wider strokes; only meaningful while inkMode is on.
  const [inkHighlight, setInkHighlight] = useState(false);
  const [inkColor, setInkColor] = useState("#e11d48");
  const [inkStrokeWidth, setInkStrokeWidth] = useState<number>(2);
  const [inkBySlideId, setInkBySlideId] = useState<Record<string, readonly ExcalidrawElement[]>>({});
  const [showInkPicker, setShowInkPicker] = useState(false);
  const pickerHideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [laserMode, setLaserMode] = useState(false);
  // Excalidraw's actual "tool:strokeWidth:opacity" state, reported by the canvas.
  // Exposed as a data attribute so tests can wait for the exact ink contract
  // (e.g. "freedraw:8:50") to be live before drawing.
  const [canvasInkState, setCanvasInkState] = useState("");
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [cmdBarOpen, setCmdBarOpen] = useState(false);
  // Ref so the keyboard handler always sees the current value without re-subscribing.
  const cmdBarOpenRef = useRef(false);
  useLayoutEffect(() => { cmdBarOpenRef.current = cmdBarOpen; }, [cmdBarOpen]);

  // Edge-reveal: two independent visibility zones for top toolbar and bottom nav.
  const [showTopControls, setShowTopControls] = useState(true); // true during orientation
  const [showNavigation, setShowNavigation] = useState(true);
  const showTopRef = useRef(true);
  const showNavRef = useRef(true);
  useLayoutEffect(() => { showTopRef.current = showTopControls; }, [showTopControls]);
  useLayoutEffect(() => { showNavRef.current = showNavigation; }, [showNavigation]);
  // Timer refs shared between the pointer-zone effect and showNavBriefly.
  const topDwellRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const topHideRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const topKeyRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const navDwellRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const navHideRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const navKeyRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Last known pointer Y, read by hide timers to avoid hiding a pinned zone.
  const pointerYRef = useRef<number | null>(null);
  const laserDotRef = useRef<HTMLDivElement>(null);
  const trailDotsRef = useRef<(HTMLDivElement | null)[]>([null, null, null, null, null]);
  const laserCursorRef = useRef<{ x: number; y: number } | null>(null);
  const laserTrailRef = useRef<Array<{ x: number; y: number; t: number }>>([]);
  const laserLastRecordedRef = useRef<{ x: number; y: number } | null>(null);
  const laserRafRef = useRef<number | undefined>(undefined);

  const showPickerBriefly = useCallback(() => {
    setShowInkPicker(true);
    clearTimeout(pickerHideTimerRef.current);
    pickerHideTimerRef.current = setTimeout(() => setShowInkPicker(false), 3000);
  }, []);

  // Briefly reveal only the slide counter (not top toolbar) after keyboard navigation.
  const showNavBriefly = useCallback(() => {
    if (cmdBarOpenRef.current) return;
    setShowNavigation(true);
    clearTimeout(navDwellRef.current); navDwellRef.current = undefined;
    clearTimeout(navHideRef.current); navHideRef.current = undefined;
    clearTimeout(navKeyRef.current);
    navKeyRef.current = setTimeout(() => {
      navKeyRef.current = undefined;
      const y = pointerYRef.current;
      if (y === null || y < window.innerHeight - BOTTOM_ZONE_PX) {
        setShowNavigation(false);
      }
    }, 1500);
  }, []);

  // Briefly reveal the top toolbar so a notes-window disconnect is noticed
  // even if the pointer isn't hovering the top edge. Holds longer than
  // showNavBriefly's, since this needs to register as a heads-up, not a blip.
  const showTopBriefly = useCallback(() => {
    if (cmdBarOpenRef.current) return;
    setShowTopControls(true);
    clearTimeout(topDwellRef.current); topDwellRef.current = undefined;
    clearTimeout(topHideRef.current); topHideRef.current = undefined;
    clearTimeout(topKeyRef.current);
    topKeyRef.current = setTimeout(() => {
      topKeyRef.current = undefined;
      const y = pointerYRef.current;
      if (y === null || y > TOP_ZONE_PX) setShowTopControls(false);
    }, 3000);
  }, []);

  useEffect(() => {
    if (!laserMode) return;

    const TRAIL_SIZES = [9, 8, 7, 6, 5] as const;
    const FADE_MS = 220;
    const MIN_DIST_SQ = 10 * 10;

    const trailLoop = (now: DOMHighResTimeStamp) => {
      const pts = laserTrailRef.current;

      while (pts.length > 0 && now - pts[0].t >= FADE_MS) pts.shift();

      // Slot 0 = newest (closest to cursor), slot N-1 = oldest
      trailDotsRef.current.forEach((el, slot) => {
        if (!el) return;
        const ptIdx = pts.length - 1 - slot;
        if (ptIdx < 0) { el.style.opacity = "0"; return; }
        const pt = pts[ptIdx];
        const life = 1 - (now - pt.t) / FADE_MS;
        const size = TRAIL_SIZES[slot];
        el.style.opacity = String(Math.max(0, life * 0.65));
        el.style.transform = `translate(${pt.x - size / 2}px, ${pt.y - size / 2}px)`;
      });

      if (pts.length > 0) {
        laserRafRef.current = requestAnimationFrame(trailLoop);
      } else {
        laserRafRef.current = undefined;
      }
    };

    const onMove = (e: PointerEvent) => {
      const { clientX: x, clientY: y } = e;
      laserCursorRef.current = { x, y };

      // Direct DOM update for zero-lag cursor tracking
      if (laserDotRef.current) {
        laserDotRef.current.style.opacity = "1";
        laserDotRef.current.style.transform = `translate(${x - 6}px, ${y - 6}px)`;
      }

      // Record a trail point only after moving at least 10 px
      const last = laserLastRecordedRef.current;
      if (!last || (x - last.x) ** 2 + (y - last.y) ** 2 >= MIN_DIST_SQ) {
        laserTrailRef.current.push({ x, y, t: performance.now() });
        if (laserTrailRef.current.length > TRAIL_SIZES.length + 2) laserTrailRef.current.shift();
        laserLastRecordedRef.current = { x, y };
        if (laserRafRef.current === undefined) {
          laserRafRef.current = requestAnimationFrame(trailLoop);
        }
      }
    };

    const hide = () => {
      cancelAnimationFrame(laserRafRef.current!);
      laserRafRef.current = undefined;
      laserCursorRef.current = null;
      laserTrailRef.current = [];
      laserLastRecordedRef.current = null;
      if (laserDotRef.current) laserDotRef.current.style.opacity = "0";
      trailDotsRef.current.forEach((el) => { if (el) el.style.opacity = "0"; });
    };

    // Capture phase runs before Excalidraw's handlers, so we receive events even
    // when Excalidraw has set pointer capture during a drag.
    window.addEventListener("pointermove", onMove, { capture: true });
    window.addEventListener("pointerleave", hide, { capture: true });
    window.addEventListener("pointercancel", hide, { capture: true });
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("pointerleave", hide, { capture: true });
      window.removeEventListener("pointercancel", hide, { capture: true });
      window.removeEventListener("blur", hide);
      cancelAnimationFrame(laserRafRef.current!);
      laserRafRef.current = undefined;
      laserTrailRef.current = [];
      laserLastRecordedRef.current = null;
    };
  }, [laserMode]);

  const canvasApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const notesWindowRef = useRef<Window | null>(null);
  const [notesStatus, setNotesStatus] = useState<NotesWindowStatus>("idle");
  const notesStatusRef = useRef<NotesWindowStatus>("idle");
  useLayoutEffect(() => { notesStatusRef.current = notesStatus; }, [notesStatus]);

  const currentIndex = slides.findIndex((s) => s.id === currentSlideId);
  const currentSlide = slides[currentIndex];

  const currentSlideHasInk = !!currentSlide &&
    !!(inkBySlideId[currentSlide.id]?.some((el) => !el.isDeleted));

  // Reveal steps: `revealStep` is the stop within the current slide, 0 = base
  // layer only. The mirroring refs are written synchronously rather than in an
  // effect, so held-down arrow keys can't act on the previous slide's step
  // count before React has re-rendered.
  const [revealStep, setRevealStep] = useState(0);
  const revealStepRef = useRef(0);
  const totalStepsRef = useRef(0);
  const stepOwnerRef = useRef(currentSlideId);

  const totalSteps = currentSlide
    ? revealStepCount(currentSlide.excalidrawData.elements, currentSlide.revealSteps)
    : 0;
  useLayoutEffect(() => { totalStepsRef.current = totalSteps; }, [totalSteps]);

  const applyStep = useCallback((step: number) => {
    revealStepRef.current = step;
    setRevealStep(step);
  }, []);

  const getVideos = (): HTMLVideoElement[] =>
    containerRef.current ? [...containerRef.current.querySelectorAll("video")] : [];

  // Explicit jumps (overview, `goto`, thumbnails) restart the target slide's
  // build; sequential back-navigation passes the previous slide's final step so
  // stepping backwards shows it as the audience last saw it.
  const handleNavigate = useCallback((id: string, step = 0) => {
    const target = slides.find((s) => s.id === id);
    stepOwnerRef.current = id;
    totalStepsRef.current = target
      ? revealStepCount(target.excalidrawData.elements, target.revealSteps)
      : 0;
    applyStep(step);
    onSelectSlide(id);
  }, [slides, applyStep, onSelectSlide]);

  // Safety net for any path that changes the slide without going through
  // handleNavigate: a stale step must never carry over to another slide.
  useEffect(() => {
    if (stepOwnerRef.current !== currentSlideId) {
      stepOwnerRef.current = currentSlideId;
      applyStep(0);
    }
  }, [currentSlideId, applyStep]);

  const goForward = useCallback(() => {
    if (revealStepRef.current < totalStepsRef.current) {
      applyStep(revealStepRef.current + 1);
      return;
    }
    const idx = slides.findIndex((s) => s.id === stepOwnerRef.current);
    if (idx >= 0 && idx < slides.length - 1) handleNavigate(slides[idx + 1].id);
  }, [slides, handleNavigate, applyStep]);

  const goBackward = useCallback(() => {
    if (revealStepRef.current > 0) {
      applyStep(revealStepRef.current - 1);
      return;
    }
    const idx = slides.findIndex((s) => s.id === stepOwnerRef.current);
    if (idx > 0) {
      const prev = slides[idx - 1];
      handleNavigate(prev.id, revealStepCount(prev.excalidrawData.elements, prev.revealSteps));
    }
  }, [slides, handleNavigate, applyStep]);

  const handleCommitInk = useCallback((slideId: string, elements: readonly ExcalidrawElement[]) => {
    setInkBySlideId((prev) => ({ ...prev, [slideId]: elements }));
  }, []);

  // Rebuilding the scene from stored data would undo the current reveal, so
  // every path that replaces the element list has to re-apply it.
  const buildSlideElements = useCallback((): ExcalidrawElement[] => {
    if (!currentSlide) return [];
    const base = withoutPresentationFrameGuide(currentSlide.excalidrawData.elements);
    const hidden = hiddenElementIds(base, currentSlide.revealSteps, revealStepRef.current);
    return applyRevealOpacity(base, hidden).map(
      (el) => ({ ...el, locked: true })
    ) as ExcalidrawElement[];
  }, [currentSlide]);

  const handleClear = useCallback(() => {
    if (!currentSlide) return;
    setInkBySlideId((prev) => {
      const next = { ...prev };
      delete next[currentSlide.id];
      return next;
    });
    // Remove ink elements from canvas, keeping the locked slide elements.
    canvasApiRef.current?.updateScene({ elements: buildSlideElements() });
  }, [currentSlide, buildSlideElements]);

  const handleUndoInk = useCallback(() => {
    if (!currentSlide) return;
    const current = inkBySlideId[currentSlide.id];
    if (!current?.length) return;
    const next = current.slice(0, -1);
    setInkBySlideId((prev) => ({ ...prev, [currentSlide.id]: next }));
    canvasApiRef.current?.updateScene({
      elements: [...buildSlideElements(), ...(next as ExcalidrawElement[])],
    });
  }, [currentSlide, inkBySlideId, buildSlideElements]);

  const openNotes = useCallback(() => {
    if (notesWindowRef.current && !notesWindowRef.current.closed) {
      notesWindowRef.current.focus();
      setNotesStatus("open");
      return;
    }
    const win = window.open(
      `/?notes&id=${encodeURIComponent(presentationId)}`,
      "presentation-notes",
      "width=520,height=420,resizable=yes",
    );
    notesWindowRef.current = win;
    setNotesStatus(win ? "open" : "blocked");
  }, [presentationId]);

  // Polls rather than relying on a same-window "unload" listener: the notes
  // window can vanish for reasons a same-origin listener won't reliably
  // catch (OS closing it with the display it's on, browser process killed).
  // Only flags a *disconnect* (status was "open" and the window is now gone),
  // not the initial "never opened" state, and flashes the top toolbar so the
  // presenter notices without hunting for it.
  useEffect(() => {
    const interval = setInterval(() => {
      const win = notesWindowRef.current;
      if (win && win.closed) {
        notesWindowRef.current = null;
        if (notesStatusRef.current === "open") {
          setNotesStatus("closed");
          showTopBriefly();
        }
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [showTopBriefly]);

  const handleCommandExecute = useCallback((cmd: ParsedCommand) => {
    setCmdBarOpen(false);
    // Sync the ref now: the layout effect runs after this event, so same-event
    // calls like showNavBriefly would otherwise still see the bar as open.
    cmdBarOpenRef.current = false;
    switch (cmd.type) {
      case "pen":
      case "highlight":
        setInkColor(cmd.color);
        setInkStrokeWidth(cmd.width);
        setInkHighlight(cmd.type === "highlight");
        setInkMode(true);
        setLaserMode(false);
        showPickerBriefly();
        break;
      case "laser":
        setLaserMode(true);
        setInkMode(false);
        break;
      case "goto":
        if (cmd.slide !== undefined) {
          // 1-based, clamped to the deck so "goto 99" lands on the last slide.
          const idx = Math.min(cmd.slide, slides.length) - 1;
          handleNavigate(slides[idx].id);
          showNavBriefly();
        } else {
          setOverviewOpen(true);
        }
        break;
      case "clear":
        handleClear();
        break;
      case "undo":
        handleUndoInk();
        break;
      case "off":
        setInkMode(false);
        setLaserMode(false);
        break;
    }
  }, [slides, handleNavigate, handleClear, handleUndoInk, showPickerBriefly, showNavBriefly]);

  // Cancel all zone timers and hide both groups, then open the command bar.
  // Kept as a handler rather than a cmdBarOpen effect to avoid setState-in-effect lint.
  const openCommandBar = useCallback(() => {
    clearTimeout(topDwellRef.current); topDwellRef.current = undefined;
    clearTimeout(topHideRef.current); topHideRef.current = undefined;
    clearTimeout(navDwellRef.current); navDwellRef.current = undefined;
    clearTimeout(navHideRef.current); navHideRef.current = undefined;
    clearTimeout(navKeyRef.current); navKeyRef.current = undefined;
    setShowTopControls(false);
    setShowNavigation(false);
    setCmdBarOpen(true);
  }, []);

  // Keyboard controls, capture phase so we intercept before Excalidraw
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Let the command bar handle all keys when it's open.
      if (cmdBarOpenRef.current) return;
      // The slide overview owns Escape/G while open (its own capture listener).
      if (overviewOpen) return;

      // Open command bar on / unless a modifier is held or focus is in a text field.
      if (e.key === "/") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const active = document.activeElement;
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          (active instanceof HTMLElement && active.isContentEditable)
        ) return;
        e.preventDefault();
        openCommandBar();
        return;
      }

      const getBlockForVideo = (video: HTMLVideoElement) =>
        (currentSlide?.videoBlocks ?? []).find((block) => block.id === video.dataset.blockId);
      const getPlaybackBounds = (video: HTMLVideoElement) =>
        getTrimBounds(getBlockForVideo(video) ?? {});

      switch (e.key) {
        case "Escape":
          if (inkMode) {
            setInkMode(false);
          } else {
            onExit();
          }
          break;
        case "p":
        case "P":
          // Toggle pen off only if it's the active ink tool; otherwise switch to it.
          if (inkMode && !inkHighlight) {
            setInkMode(false);
          } else {
            setInkMode(true);
            setInkHighlight(false);
            setLaserMode(false);
            showPickerBriefly();
          }
          break;
        case "h":
        case "H":
          if (inkMode && inkHighlight) {
            setInkMode(false);
          } else {
            setInkMode(true);
            setInkHighlight(true);
            setLaserMode(false);
            showPickerBriefly();
          }
          break;
        case "g":
        case "G":
          if (e.ctrlKey || e.metaKey || e.altKey) break; // Cmd/Ctrl+G is a browser shortcut
          setOverviewOpen(true);
          break;
        case "z":
        case "Z":
          if (e.ctrlKey || e.metaKey) {
            // Direct undo, since synthetic dispatch is unreliable cross-platform and lacks canvas focus.
            e.preventDefault();
            handleUndoInk();
            break;
          }
          setLaserMode((m) => {
            if (!m) setInkMode(false);
            return !m;
          });
          break;
        case "c":
        case "C":
          handleClear();
          break;
        case "n":
        case "N":
          openNotes();
          break;
        case "ArrowRight":
        case " ":
          e.preventDefault();
          goForward();
          showNavBriefly();
          break;
        case "ArrowLeft":
          goBackward();
          showNavBriefly();
          break;
        case "v":
        case "V": {
          // Resume the first paused video that has breakpoints defined.
          const blocksWithBp = (currentSlide?.videoBlocks ?? []).filter(b => b.breakpoints?.length);
          const videos = getVideos();
          for (const b of blocksWithBp) {
            const el = videos.find((video) => video.dataset.blockId === b.id);
            if (el && el.paused) { el.play().catch(() => {}); break; }
          }
          break;
        }
        case "r":
        case "R":
          getVideos().forEach((v) => {
            v.currentTime = getPlaybackBounds(v).start;
            v.play().catch(() => {});
          });
          break;
        case "j":
        case "J": {
          const v = getVideos()[0];
          if (v) {
            v.currentTime = clampToPlayableRange(v.currentTime - 5, getPlaybackBounds(v), v.duration);
          }
          break;
        }
        case "k":
        case "K": {
          const first = getVideos()[0];
          if (first) {
            if (first.paused) {
              // At trim/media end, resume from trim start rather than
              // re-pausing immediately on the boundary.
              const resumeAt = playbackResumeTime(
                first.currentTime, getPlaybackBounds(first), first.duration, first.ended
              );
              if (resumeAt !== first.currentTime) first.currentTime = resumeAt;
              first.play().catch(() => {});
            } else {
              first.pause();
            }
          }
          break;
        }
        case "l":
        case "L": {
          const v = getVideos()[0];
          if (v) {
            v.currentTime = clampToPlayableRange(v.currentTime + 5, getPlaybackBounds(v), v.duration);
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [currentIndex, slides, currentSlide?.videoBlocks, inkMode, inkHighlight, laserMode, overviewOpen, handleNavigate, goForward, goBackward, handleClear, handleUndoInk, openNotes, onExit, showPickerBriefly, showNavBriefly, openCommandBar]);

  // Show both groups on mount for 2s so the user gets oriented before controls disappear.
  // Skip hiding a group if the pointer is already parked in its zone.
  useEffect(() => {
    const t = setTimeout(() => {
      const y = pointerYRef.current;
      if (y === null || y > TOP_ZONE_PX) setShowTopControls(false);
      if (y === null || y < window.innerHeight - BOTTOM_ZONE_PX) setShowNavigation(false);
    }, 2000);
    return () => clearTimeout(t);
  }, []);

  // Clear timers that are not owned by the pointer-zone effect on unmount.
  useEffect(() => {
    return () => {
      clearTimeout(navKeyRef.current);
      clearTimeout(pickerHideTimerRef.current);
    };
  }, []);

  // Pointer-zone edge-reveal: runs once, reads live state through refs.
  useEffect(() => {
    const DWELL_MS = 200;
    const HIDE_MS = 1500;

    const onPointerMove = (e: PointerEvent) => {
      const { clientY } = e;
      pointerYRef.current = clientY; // always track so orientation timer can read it
      if (cmdBarOpenRef.current) return;
      const h = window.innerHeight;
      const inTop = clientY <= TOP_ZONE_PX;
      const inBottom = clientY >= h - BOTTOM_ZONE_PX;

      if (inTop) {
        if (!showTopRef.current && !topDwellRef.current) {
          topDwellRef.current = setTimeout(() => {
            topDwellRef.current = undefined;
            setShowTopControls(true);
          }, DWELL_MS);
        }
        clearTimeout(topHideRef.current);
        topHideRef.current = undefined;
      } else {
        clearTimeout(topDwellRef.current);
        topDwellRef.current = undefined;
        if (showTopRef.current && !topHideRef.current) {
          topHideRef.current = setTimeout(() => {
            topHideRef.current = undefined;
            setShowTopControls(false);
          }, HIDE_MS);
        }
      }

      if (inBottom) {
        if (!showNavRef.current && !navDwellRef.current) {
          navDwellRef.current = setTimeout(() => {
            navDwellRef.current = undefined;
            setShowNavigation(true);
          }, DWELL_MS);
        }
        clearTimeout(navHideRef.current);
        navHideRef.current = undefined;
      } else {
        clearTimeout(navDwellRef.current);
        navDwellRef.current = undefined;
        if (showNavRef.current && !navHideRef.current) {
          navHideRef.current = setTimeout(() => {
            navHideRef.current = undefined;
            setShowNavigation(false);
          }, HIDE_MS);
        }
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || cmdBarOpenRef.current) return;
      setShowTopControls(true);
      setShowNavigation(true);
      clearTimeout(topDwellRef.current); topDwellRef.current = undefined;
      clearTimeout(topHideRef.current);
      topHideRef.current = setTimeout(() => { topHideRef.current = undefined; setShowTopControls(false); }, HIDE_MS);
      clearTimeout(navDwellRef.current); navDwellRef.current = undefined;
      clearTimeout(navHideRef.current);
      navHideRef.current = setTimeout(() => { navHideRef.current = undefined; setShowNavigation(false); }, HIDE_MS);
    };

    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      clearTimeout(topDwellRef.current);
      clearTimeout(topHideRef.current);
      clearTimeout(navDwellRef.current);
      clearTimeout(navHideRef.current);
    };
  }, []);

  const noop = () => {};

  const inkData = currentSlide
    ? inkBySlideId[currentSlide.id]
      ? { elements: inkBySlideId[currentSlide.id], appState: {} as AppState, files: {} }
      : undefined
    : undefined;

  const currentInkElements = currentSlide ? (inkBySlideId[currentSlide.id] ?? []) : [];
  const inkCount = currentInkElements.length;
  const translucentInkCount = currentInkElements.filter((el) => el.opacity < 100).length;
  const lastInkStrokeWidth = currentInkElements[currentInkElements.length - 1]?.strokeWidth ?? "";

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-black overflow-hidden"
      data-testid="presentation-view"
      data-ink-count={inkCount}
      data-translucent-ink-count={translucentInkCount}
      data-last-ink-stroke-width={lastInkStrokeWidth}
      data-canvas-ink-state={canvasInkState}
    >
      {currentSlide && (
        <>
          <PresentationCanvas
            key={currentSlide.id}
            slide={currentSlide}
            revealStep={revealStep}
            inkMode={inkMode}
            inkHighlight={inkHighlight}
            inkColor={inkColor}
            inkStrokeWidth={inkStrokeWidth}
            initialInk={inkData}
            onInkCommit={(els) => handleCommitInk(currentSlide.id, els)}
            onApiReady={(api) => { canvasApiRef.current = api; }}
            onInkStateChange={setCanvasInkState}
          />
          <VideoOverlayLayer
            blocks={currentSlide.videoBlocks}
            selectedVideoId={null}
            mode="present"
            onSelectVideo={noop}
            onUpdateVideo={noop}
            onDeleteVideo={noop}
          />
        </>
      )}

      {/* Laser pointer: global cursor override + trail + main dot, all via RAF */}
      {laserMode && (
        <>
          <style>{`* { cursor: none !important; }`}</style>
          {([9, 8, 7, 6, 5] as const).map((size, i) => (
            <div
              key={i}
              ref={(el) => { trailDotsRef.current[i] = el; }}
              className="fixed pointer-events-none z-50 opacity-0"
              style={{ top: 0, left: 0, width: size, height: size, borderRadius: "50%", backgroundColor: "rgb(239,68,68)" }}
            />
          ))}
          <div
            ref={laserDotRef}
            className="fixed pointer-events-none z-50 opacity-0"
            style={{
              top: 0, left: 0, width: 12, height: 12, borderRadius: "50%",
              backgroundColor: "rgb(239,68,68)",
              boxShadow: "0 0 6px 2px rgba(239,68,68,0.45), 0 0 12px 4px rgba(239,68,68,0.15)",
            }}
          />
        </>
      )}

      {/* Top controls group: ink toolbar (top-left) + exit/notes (top-right) */}
      <div
        data-testid="presentation-top-controls"
        className="absolute inset-0 z-30 pointer-events-none"
        style={{
          opacity: showTopControls ? 1 : 0,
          visibility: showTopControls ? "visible" : "hidden",
          transition: showTopControls
            ? "opacity 500ms ease, visibility 0ms"
            : "opacity 500ms ease, visibility 0ms 500ms",
        }}
      >
        {/* Ink toolbar (top left) */}
        <div className="absolute top-4 left-4 flex flex-col gap-2 pointer-events-auto">
          {/* Pen toggle + clear */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                if (!inkMode || inkHighlight) {
                  setInkMode(true);
                  setInkHighlight(false);
                  setLaserMode(false);
                  showPickerBriefly();
                } else if (showInkPicker) {
                  setInkMode(false);
                  setShowInkPicker(false);
                  clearTimeout(pickerHideTimerRef.current);
                } else {
                  showPickerBriefly();
                }
              }}
              title="Toggle annotation mode (P)"
              aria-pressed={inkMode && !inkHighlight}
              className={`w-8 h-8 flex items-center justify-center rounded transition-colors text-sm ${
                inkMode && !inkHighlight
                  ? "bg-rose-600 text-white"
                  : "bg-white/10 hover:bg-white/20 text-white/60 hover:text-white"
              }`}
            >
              ✏
            </button>
            <button
              onClick={() => {
                if (!inkMode || !inkHighlight) {
                  setInkMode(true);
                  setInkHighlight(true);
                  setLaserMode(false);
                  showPickerBriefly();
                } else if (showInkPicker) {
                  setInkMode(false);
                  setShowInkPicker(false);
                  clearTimeout(pickerHideTimerRef.current);
                } else {
                  showPickerBriefly();
                }
              }}
              title="Toggle highlighter (H)"
              aria-pressed={inkMode && inkHighlight}
              className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                inkMode && inkHighlight
                  ? "bg-rose-600 text-white"
                  : "bg-white/10 hover:bg-white/20 text-white/60 hover:text-white"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 11l1.8-.45L11 4.35a1.1 1.1 0 0 0-1.55-1.55L3.25 9l-.25 2z" fill="currentColor" />
                <rect x="2" y="12" width="10" height="1.5" rx="0.75" fill="currentColor" opacity="0.45" />
              </svg>
            </button>
            <button
              onClick={() => {
                setLaserMode((m) => {
                  if (!m) setInkMode(false);
                  return !m;
                });
              }}
              title="Laser pointer (Z)"
              aria-pressed={laserMode}
              className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                laserMode
                  ? "bg-rose-600 text-white"
                  : "bg-white/10 hover:bg-white/20 text-white/60 hover:text-white"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="2.5" fill="currentColor" />
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1" opacity="0.6" />
              </svg>
            </button>
            {(inkMode || currentSlideHasInk) && (
              <button
                onClick={handleClear}
                title="Clear ink (C)"
                className="w-8 h-8 flex items-center justify-center rounded bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors text-sm"
              >
                ✕
              </button>
            )}
          </div>

          {/* Color + stroke width picker: fades after 3s, click ✏ to reshow */}
          {inkMode && (
            <div className={`flex items-center gap-1.5 bg-black/50 rounded-lg px-2.5 py-2 transition-opacity duration-500 ${showInkPicker ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
              {INK_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => { setInkColor(c.value); showPickerBriefly(); }}
                  title={c.label}
                  aria-pressed={inkColor === c.value}
                  className={`w-5 h-5 rounded-full transition-transform ${
                    inkColor === c.value
                      ? "ring-2 ring-white ring-offset-1 ring-offset-black scale-110"
                      : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
              <div className="w-px h-4 bg-white/20 mx-0.5" />
              {INK_WIDTHS.map((w) => (
                <button
                  key={w}
                  onClick={() => { setInkStrokeWidth(w); showPickerBriefly(); }}
                  title={`Stroke width ${w}`}
                  aria-pressed={inkStrokeWidth === w}
                  className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                    inkStrokeWidth === w ? "bg-white/30" : "hover:bg-white/10"
                  }`}
                >
                  <div
                    className="rounded-full bg-white"
                    style={{ width: w * 3, height: w * 3 }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Top-right: exit hint + notes */}
        <div className="absolute top-4 right-4 flex items-center gap-3 pointer-events-auto">
          <button
            onClick={openNotes}
            data-testid="notes-button"
            data-status={notesStatus}
            title={
              notesStatus === "closed"
                ? "Notes window closed — click to reopen (N)"
                : notesStatus === "blocked"
                ? "Pop-up blocked — allow pop-ups for this site, then click to open notes (N)"
                : "Open notes window (N)"
            }
            className={`flex items-center gap-1.5 text-xs transition-colors ${
              notesStatus === "closed" || notesStatus === "blocked"
                ? "text-amber-400/90 hover:text-amber-300"
                : "text-white/30 hover:text-white/70"
            }`}
          >
            {(notesStatus === "closed" || notesStatus === "blocked") && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />
            )}
            {notesStatus === "open" && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            )}
            Notes
          </button>
          <button
            onClick={inkMode ? () => setInkMode(false) : onExit}
            className="text-xs text-white/30 hover:text-white/70 transition-colors"
          >
            {inkMode ? "Esc to stop drawing" : "Esc to exit"}
          </button>
        </div>
      </div>

      {/* Navigation group: slide counter + prev/next */}
      <div
        data-testid="presentation-nav-controls"
        className="absolute inset-0 z-30 pointer-events-none"
        style={{
          opacity: showNavigation ? 1 : 0,
          visibility: showNavigation ? "visible" : "hidden",
          transition: showNavigation
            ? "opacity 500ms ease, visibility 0ms"
            : "opacity 500ms ease, visibility 0ms 500ms",
        }}
      >
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 pointer-events-auto">
          <button
            onClick={goBackward}
            disabled={currentIndex === 0 && revealStep === 0}
            title={revealStep > 0 ? "Previous step (←)" : "Previous slide (←)"}
            className="px-3 py-1 text-sm bg-white/10 hover:bg-white/20 text-white rounded disabled:opacity-30 transition-colors"
          >
            ←
          </button>
          <span data-testid="presentation-counter" className="text-xs text-white/50 tabular-nums">
            {currentIndex + 1} / {slides.length}
            {totalSteps > 0 && (
              <span className="ml-1.5 text-white/35">· {revealStep} / {totalSteps}</span>
            )}
          </span>
          <button
            onClick={goForward}
            disabled={currentIndex === slides.length - 1 && revealStep === totalSteps}
            title={revealStep < totalSteps ? "Next step (→)" : "Next slide (→)"}
            className="px-3 py-1 text-sm bg-white/10 hover:bg-white/20 text-white rounded disabled:opacity-30 transition-colors"
          >
            →
          </button>
        </div>
      </div>

      {overviewOpen && (
        <SlideOverview
          slides={slides}
          currentSlideId={currentSlideId}
          onSelect={(id) => {
            handleNavigate(id);
            setOverviewOpen(false);
            showNavBriefly();
          }}
          onClose={() => setOverviewOpen(false)}
        />
      )}

      {cmdBarOpen && (
        <CommandBar
          inkMode={inkMode}
          inkHighlight={inkHighlight}
          inkColor={inkColor}
          inkStrokeWidth={inkStrokeWidth}
          laserMode={laserMode}
          onExecute={handleCommandExecute}
          onClose={() => setCmdBarOpen(false)}
        />
      )}
    </div>
  );
}
