import { describe, it, expect } from "vitest";
import { parseExcalidrawFile } from "./excalidrawImport";
import type { Presentation } from "../types/presentation";

// Minimal helpers to build fake Excalidraw elements
const frame = (id: string, x: number, y: number, w: number, h: number, name?: string) => ({
  type: "frame", id, x, y, width: w, height: h, name: name ?? id, isDeleted: false,
});

const rect = (id: string, x: number, y: number, w: number, h: number, frameId?: string) => ({
  type: "rectangle", id, x, y, width: w, height: h,
  ...(frameId ? { frameId } : {}),
  isDeleted: false,
});

const excalidrawFile = (elements: object[], appState = {}, files = {}) => ({
  type: "excalidraw", version: 2, elements, appState, files,
});

describe("parseExcalidrawFile — validation", () => {
  it("rejects null", () => {
    expect(parseExcalidrawFile("test.excalidraw", null)).toBeTypeOf("string");
  });

  it("rejects missing elements array", () => {
    expect(parseExcalidrawFile("test.excalidraw", { appState: {} })).toBeTypeOf("string");
  });

  it("rejects non-object input", () => {
    expect(parseExcalidrawFile("test.excalidraw", "not json")).toBeTypeOf("string");
  });
});

describe("parseExcalidrawFile — no frames", () => {
  it("imports whole drawing as one slide", () => {
    const file = excalidrawFile([
      rect("r1", 10, 10, 100, 50),
      rect("r2", 200, 200, 80, 80),
    ]);
    const result = parseExcalidrawFile("my-diagram.excalidraw", file) as Presentation;
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0].title).toBe("Slide 1");
    expect(result.slides[0].excalidrawData.elements).toHaveLength(2);
    expect(result.title).toBe("my-diagram");
  });

  it("skips deleted elements", () => {
    const file = excalidrawFile([
      rect("r1", 10, 10, 100, 50),
      { ...rect("r2", 200, 200, 80, 80), isDeleted: true },
    ]);
    const result = parseExcalidrawFile("test.excalidraw", file) as Presentation;
    expect(result.slides[0].excalidrawData.elements).toHaveLength(1);
  });
});

describe("parseExcalidrawFile — frames via frameId", () => {
  it("creates one slide per frame sorted left-to-right", () => {
    // Frame B is to the left of frame A
    const file = excalidrawFile([
      frame("fB", 900, 0, 800, 600, "Arrays"),
      frame("fA", 0, 0, 800, 600, "Intro"),
      rect("r1", 50, 50, 100, 100, "fA"),
      rect("r2", 950, 50, 100, 100, "fB"),
    ]);
    const result = parseExcalidrawFile("lesson.excalidraw", file) as Presentation;
    expect(result.slides).toHaveLength(2);
    expect(result.slides[0].title).toBe("Intro");
    expect(result.slides[1].title).toBe("Arrays");
    expect(result.title).toBe("lesson");
  });

  it("does not include frame element itself in slide content", () => {
    const file = excalidrawFile([
      frame("f1", 0, 0, 800, 600, "Slide One"),
      rect("r1", 10, 10, 50, 50, "f1"),
    ]);
    const result = parseExcalidrawFile("test.excalidraw", file) as Presentation;
    const elements = result.slides[0].excalidrawData.elements as object[];
    expect(elements.every((el: object) => (el as { type: string }).type !== "frame")).toBe(true);
  });

  it("normalizes element coordinates relative to frame origin", () => {
    const file = excalidrawFile([
      frame("f1", 400, 200, 800, 600),
      rect("r1", 450, 250, 100, 100, "f1"),
    ]);
    const result = parseExcalidrawFile("test.excalidraw", file) as Presentation;
    const el = result.slides[0].excalidrawData.elements[0] as { x: number; y: number };
    expect(el.x).toBe(50);   // 450 - 400
    expect(el.y).toBe(50);   // 250 - 200
  });

  it("strips frameId from normalized elements", () => {
    const file = excalidrawFile([
      frame("f1", 0, 0, 800, 600),
      rect("r1", 10, 10, 50, 50, "f1"),
    ]);
    const result = parseExcalidrawFile("test.excalidraw", file) as Presentation;
    const el = result.slides[0].excalidrawData.elements[0] as Record<string, unknown>;
    expect(el.frameId).toBeUndefined();
  });

  it("uses frame name as slide title, falls back to Slide N", () => {
    const file = excalidrawFile([
      frame("f1", 0, 0, 800, 600, "  My Frame  "),
      frame("f2", 900, 0, 800, 600, ""),   // blank name → fallback
      rect("r1", 10, 10, 50, 50, "f1"),
      rect("r2", 910, 10, 50, 50, "f2"),
    ]);
    const result = parseExcalidrawFile("test.excalidraw", file) as Presentation;
    expect(result.slides[0].title).toBe("My Frame");
    expect(result.slides[1].title).toBe("Slide 2");
  });

  it("uses y as tiebreaker when frames have the same x", () => {
    const file = excalidrawFile([
      frame("fB", 0, 500, 800, 400, "Bottom"),
      frame("fA", 0, 0, 800, 400, "Top"),
      rect("r1", 10, 10, 50, 50, "fA"),
      rect("r2", 10, 510, 50, 50, "fB"),
    ]);
    const result = parseExcalidrawFile("test.excalidraw", file) as Presentation;
    expect(result.slides[0].title).toBe("Top");
    expect(result.slides[1].title).toBe("Bottom");
  });
});

describe("parseExcalidrawFile — frames via center-point fallback", () => {
  it("assigns elements whose center falls inside the frame", () => {
    // No frameId on elements, so this uses the geometric fallback.
    const file = excalidrawFile([
      frame("f1", 0, 0, 800, 600, "Slide 1"),
      { type: "rectangle", id: "r1", x: 350, y: 250, width: 100, height: 100, isDeleted: false },
    ]);
    const result = parseExcalidrawFile("test.excalidraw", file) as Presentation;
    // center of r1 = (350+50, 250+50) = (400, 300), inside frame (0,0,800,600)
    expect(result.slides[0].excalidrawData.elements).toHaveLength(1);
  });

  it("excludes elements whose center is outside the frame", () => {
    const file = excalidrawFile([
      frame("f1", 0, 0, 100, 100, "Tiny"),
      { type: "rectangle", id: "r1", x: 200, y: 200, width: 100, height: 100, isDeleted: false },
    ]);
    const result = parseExcalidrawFile("test.excalidraw", file) as Presentation;
    // center (250, 250) is outside frame (0,0,100,100)
    expect(result.slides[0].excalidrawData.elements).toHaveLength(0);
  });
});

describe("parseExcalidrawFile — title extraction", () => {
  it("strips .excalidraw extension", () => {
    const result = parseExcalidrawFile("binary-search.excalidraw", excalidrawFile([])) as Presentation;
    expect(result.title).toBe("binary-search");
  });

  it("strips .json extension", () => {
    const result = parseExcalidrawFile("graphs.json", excalidrawFile([])) as Presentation;
    expect(result.title).toBe("graphs");
  });

  it("falls back when filename is just the extension", () => {
    const result = parseExcalidrawFile(".excalidraw", excalidrawFile([])) as Presentation;
    expect(result.title).toBe("Imported Excalidraw");
  });
});

describe("parseExcalidrawFile — output shape", () => {
  it("slides have empty notes and no video blocks", () => {
    const file = excalidrawFile([rect("r1", 10, 10, 50, 50)]);
    const result = parseExcalidrawFile("test.excalidraw", file) as Presentation;
    expect(result.slides[0].notes).toBe("");
    expect(result.slides[0].videoBlocks).toHaveLength(0);
  });

  it("currentSlideId points to first slide", () => {
    const file = excalidrawFile([
      frame("f1", 0, 0, 800, 600, "First"),
      frame("f2", 900, 0, 800, 600, "Second"),
      rect("r1", 10, 10, 50, 50, "f1"),
    ]);
    const result = parseExcalidrawFile("test.excalidraw", file) as Presentation;
    expect(result.currentSlideId).toBe(result.slides[0].id);
  });

  it("preserves viewBackgroundColor from appState, drops everything else", () => {
    const file = excalidrawFile(
      [rect("r1", 10, 10, 50, 50)],
      { viewBackgroundColor: "#1e1e2e", selectedElementIds: { r1: true }, zoom: { value: 1.5 } },
    );
    const result = parseExcalidrawFile("test.excalidraw", file) as Presentation;
    const appState = result.slides[0].excalidrawData.appState;
    expect(appState.viewBackgroundColor).toBe("#1e1e2e");
    expect((appState as Record<string, unknown>).selectedElementIds).toBeUndefined();
    expect((appState as Record<string, unknown>).zoom).toBeUndefined();
  });
});
