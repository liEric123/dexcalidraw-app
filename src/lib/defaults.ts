import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { generateId } from "./ids";
import { cloneRevealSteps } from "./revealSteps";
import type { ExcalidrawData, Presentation, Slide } from "../types/presentation";

function cloneExcalidrawData(data: ExcalidrawData): ExcalidrawData {
  return {
    elements: data.elements.map((el) => ({ ...el })),
    appState: { ...data.appState },
    files: { ...data.files },
  };
}

export function createDefaultSlide(title = "Slide 1"): Slide {
  return {
    id: generateId(),
    title,
    excalidrawData: { elements: [], appState: {}, files: {} },
    videoBlocks: [],
    notes: "",
  };
}

export function createDefaultPresentation(): Presentation {
  const slide = createDefaultSlide();
  return {
    id: generateId(),
    title: "Untitled Presentation",
    slides: [slide],
    currentSlideId: slide.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Demo elements are built by hand as plain data (same approach as
// `createPresentationFrameGuide` in presentationFrame.ts) rather than via
// `convertToExcalidrawElements`, which pulls in the full `@excalidraw/excalidraw`
// component tree and needs a `window`. defaults.ts is imported by storage.ts
// and usePresentation.ts, both covered by node-environment unit tests, so it
// must stay free of that dependency.
let demoElementSeed = 1;

function demoBaseFields(id: string) {
  return {
    id,
    angle: 0,
    groupIds: [] as string[],
    frameId: null,
    roundness: null,
    seed: demoElementSeed++,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
}

function demoRect(opts: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  backgroundColor?: string;
}): ExcalidrawElement {
  return {
    ...demoBaseFields(opts.id),
    type: "rectangle",
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    strokeColor: opts.strokeColor ?? "#78716c",
    backgroundColor: opts.backgroundColor ?? "transparent",
    fillStyle: "solid",
    strokeWidth: 1.5,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
  } as unknown as ExcalidrawElement;
}

function demoText(opts: {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  strokeColor?: string;
}): ExcalidrawElement {
  const fontSize = opts.fontSize ?? 20;
  const longestLine = Math.max(...opts.text.split("\n").map((l) => l.length));
  return {
    ...demoBaseFields(opts.id),
    type: "text",
    x: opts.x,
    y: opts.y,
    width: Math.max(20, longestLine * fontSize * 0.55),
    height: fontSize * 1.25 * opts.text.split("\n").length,
    strokeColor: opts.strokeColor ?? "#1c1917",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    text: opts.text,
    originalText: opts.text,
    fontSize,
    fontFamily: 1,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  } as unknown as ExcalidrawElement;
}

function slideFromElements(title: string, elements: ExcalidrawElement[]): Slide {
  return {
    id: generateId(),
    title,
    excalidrawData: { elements, appState: {}, files: {} },
    videoBlocks: [],
    notes: "",
  };
}

function buildWelcomeSlide(): Slide {
  return slideFromElements("Welcome", [
    demoRect({
      id: "demo-w-accent",
      x: 160,
      y: 258,
      width: 8,
      height: 96,
      strokeColor: "transparent",
      backgroundColor: "#6366f1",
    }),
    demoText({ id: "demo-w-title", x: 200, y: 260, text: "Dexcalidraw", fontSize: 72 }),
    demoText({
      id: "demo-w-subtitle",
      x: 200,
      y: 372,
      text: "A local-first presentation tool built natively on Excalidraw,\nfor recording CS/DSA lessons.",
      fontSize: 26,
      strokeColor: "#57534e",
    }),
    demoText({
      id: "demo-w-note",
      x: 200,
      y: 460,
      text: "This is a demo deck. Click Present in the top bar to see reveal steps and presenter mode in action.",
      fontSize: 18,
      strokeColor: "#a8a29e",
    }),
  ]);
}

// A binary-search walkthrough used to showcase reveal steps: the boxes and
// title are the always-visible base layer, and each step adds a pointer +
// explanation line above the previous one's, so presenting reads as a
// running derivation rather than one line being swapped for another.
function buildRevealStepsSlide(): Slide {
  const BOX_W = 180;
  const BOX_H = 120;
  const GAP = 40;
  const START_X = 270;
  const BOX_Y = 320;
  const values = [4, 9, 15, 23, 42];
  const boxX = (i: number) => START_X + i * (BOX_W + GAP);
  const boxCenterX = (i: number) => boxX(i) + BOX_W / 2;
  const PTR_Y = BOX_Y + BOX_H + 12;

  const boxes = values.flatMap((value, i): ExcalidrawElement[] => {
    const label = String(value);
    return [
      demoRect({
        id: `demo-rs-box${i}`,
        x: boxX(i),
        y: BOX_Y,
        width: BOX_W,
        height: BOX_H,
        backgroundColor: "#eef2ff",
      }),
      demoText({
        id: `demo-rs-box${i}-label`,
        x: boxCenterX(i) - label.length * 36 * 0.3,
        y: BOX_Y + BOX_H / 2 - 18,
        text: label,
        fontSize: 36,
      }),
    ];
  });

  const elements: ExcalidrawElement[] = [
    demoText({ id: "demo-rs-title", x: 160, y: 70, text: "Reveal steps: walk through ideas live", fontSize: 40 }),
    demoText({
      id: "demo-rs-subtitle",
      x: 160,
      y: 132,
      text: "Binary search for 23 in a sorted array. Click through steps while presenting.",
      fontSize: 22,
      strokeColor: "#57534e",
    }),
    demoText({ id: "demo-rs-target", x: 160, y: 190, text: "target = 23", fontSize: 22, strokeColor: "#4f46e5" }),
    ...boxes,
    demoText({
      id: "demo-rs-ptr1",
      x: boxCenterX(2) - 14,
      y: PTR_Y,
      text: "▲",
      fontSize: 32,
      strokeColor: "#4f46e5",
    }),
    demoText({
      id: "demo-rs-text1",
      x: 160,
      y: 560,
      text: "mid = arr[2] = 15  →  15 < 23, search the right half",
      fontSize: 22,
      strokeColor: "#4f46e5",
    }),
    demoText({
      id: "demo-rs-ptr2",
      x: boxCenterX(3) - 14,
      y: PTR_Y,
      text: "▲",
      fontSize: 32,
      strokeColor: "#16a34a",
    }),
    demoText({
      id: "demo-rs-text2",
      x: 160,
      y: 605,
      text: "mid = arr[3] = 23  →  found it! 🎉",
      fontSize: 22,
      strokeColor: "#16a34a",
    }),
  ];

  const slide = slideFromElements("Reveal steps", elements);
  slide.revealSteps = [
    ["demo-rs-ptr1", "demo-rs-text1"],
    ["demo-rs-ptr2", "demo-rs-text2"],
  ];
  return slide;
}

function buildFeaturesSlide(): Slide {
  const items = [
    "Native Excalidraw canvas for every slide",
    "Local video overlays with trim points and breakpoints",
    "Reveal steps to build ideas up live, like the previous slide",
    "Full-screen presenter mode with laser pointer and temporary ink",
    "Mermaid → editable diagram import",
    "Export a portable .zip backup, no account needed",
  ];
  return slideFromElements("What Dexcalidraw can do", [
    demoText({ id: "demo-f-title", x: 160, y: 80, text: "Everything lives in your browser", fontSize: 40 }),
    ...items.map((item, i) =>
      demoText({ id: `demo-f-item${i}`, x: 200, y: 220 + i * 68, text: `✓ ${item}`, fontSize: 24 })
    ),
  ]);
}

// A pre-built showcase deck seeded once per browser (see
// `seedDemoPresentationIfFirstRun` in storage.ts) so a fresh visitor sees a
// working example instead of an empty dashboard.
export function createDemoPresentation(): Presentation {
  const welcome = buildWelcomeSlide();
  const revealSteps = buildRevealStepsSlide();
  const features = buildFeaturesSlide();
  const slides = [welcome, revealSteps, features];
  return {
    id: generateId(),
    title: "Dexcalidraw Demo",
    slides,
    currentSlideId: welcome.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Builds a fresh, non-template presentation from a template's slides (layout,
// notes, video block positions/settings) under all-new ids. The actual video
// blobs are never copied here (callers do that, async, via the returned id
// pairs). `includeVideos` only controls whether the block metadata (name,
// file info) is kept as a label for the file you'll drop in, or reset to a
// generic placeholder because no file is coming along.
export function createPresentationFromTemplate(
  template: Presentation,
  includeVideos: boolean
): { presentation: Presentation; videoIdPairs: { oldId: string; newId: string }[] } {
  const videoIdPairs: { oldId: string; newId: string }[] = [];

  const slides: Slide[] = template.slides.map((s) => ({
    ...s,
    id: generateId(),
    excalidrawData: cloneExcalidrawData(s.excalidrawData),
    videoBlocks: s.videoBlocks.map((b) => {
      const newId = generateId();
      videoIdPairs.push({ oldId: b.id, newId });
      const copy = {
        ...b,
        id: newId,
        src: "",
        breakpoints: b.breakpoints ? [...b.breakpoints] : undefined,
      };
      return includeVideos
        ? copy
        : { ...copy, name: "Video", fileName: undefined, mimeType: undefined };
    }),
    notesDrawing: s.notesDrawing ? cloneExcalidrawData(s.notesDrawing) : undefined,
    presentationFrame: s.presentationFrame ? { ...s.presentationFrame } : undefined,
    // Element ids are preserved by cloneExcalidrawData, so step assignments
    // stay valid, but the arrays must not be shared with the template.
    revealSteps: cloneRevealSteps(s.revealSteps),
  }));

  return {
    presentation: {
      id: generateId(),
      title: template.title,
      slides,
      currentSlideId: slides[0]?.id ?? "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isTemplate: false,
    },
    videoIdPairs,
  };
}
