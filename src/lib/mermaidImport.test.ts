// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

// The real parser needs a full browser (mermaid renders off-screen SVG to
// measure the graph); Playwright covers that path. Here we mock the parse
// step and exercise the real skeleton→element conversion and validation.
const parseMermaidToExcalidraw = vi.fn();
vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: (...args: unknown[]) => parseMermaidToExcalidraw(...args),
}));

// @excalidraw/excalidraw touches a 2D canvas context at import time; jsdom
// has no canvas implementation, so stub the minimum it reads. The module
// under test is imported afterwards (static imports would hoist above this).
HTMLCanvasElement.prototype.getContext = (() => ({
  filter: "",
  font: "",
  measureText: (text: string) => ({ width: text.length * 10 }),
  save: () => {},
  restore: () => {},
  scale: () => {},
  translate: () => {},
  clearRect: () => {},
  fillText: () => {},
})) as unknown as HTMLCanvasElement["getContext"];

const {
  convertMermaidToElements,
  centerElementsOnFrame,
  MAX_MERMAID_SOURCE_LENGTH,
  MERMAID_NOT_EDITABLE_ERROR,
} = await import("./mermaidImport");

// Label-free skeletons: text layout would require canvas APIs jsdom lacks.
const flowchartSkeletons = [
  { type: "rectangle", id: "A", x: 0, y: 0, width: 120, height: 60 },
  { type: "rectangle", id: "B", x: 200, y: 0, width: 120, height: 60 },
  { type: "arrow", x: 120, y: 30, width: 80, height: 0, start: { id: "A" }, end: { id: "B" } },
];

beforeEach(() => {
  parseMermaidToExcalidraw.mockReset();
});

describe("convertMermaidToElements", () => {
  test("rejects empty and whitespace-only input without invoking the parser", async () => {
    expect(await convertMermaidToElements("")).toBe("Enter a Mermaid diagram first.");
    expect(await convertMermaidToElements("  \n ")).toBe("Enter a Mermaid diagram first.");
    expect(parseMermaidToExcalidraw).not.toHaveBeenCalled();
  });

  test("rejects oversized input without invoking the parser", async () => {
    const result = await convertMermaidToElements("x".repeat(MAX_MERMAID_SOURCE_LENGTH + 1));
    expect(result).toContain("too large");
    expect(parseMermaidToExcalidraw).not.toHaveBeenCalled();
  });

  test.each([
    "gantt\n  Task :2026-01-01, 1d",
    "pie\n  \"A\": 1",
    "timeline\n  2026 : Event",
  ])("rejects unsupported renderers before invoking Mermaid", async (source) => {
    expect(await convertMermaidToElements(source)).toBe(MERMAID_NOT_EDITABLE_ERROR);
    expect(parseMermaidToExcalidraw).not.toHaveBeenCalled();
  });

  test.each([
    "%%{init: { 'securityLevel': 'loose' }}%%\nflowchart TD\n A --> B",
    "---\nconfig:\n  securityLevel: loose\n---\nflowchart TD\n A --> B",
  ])("rejects source-level configuration before invoking Mermaid", async (source) => {
    expect(await convertMermaidToElements(source)).toContain("configuration directives");
    expect(parseMermaidToExcalidraw).not.toHaveBeenCalled();
  });

  test("allows directive-like text inside a diagram label", async () => {
    parseMermaidToExcalidraw.mockResolvedValue({ elements: flowchartSkeletons });
    const result = await convertMermaidToElements('flowchart TD\n A["Explain %%{ syntax"]');
    expect(typeof result).not.toBe("string");
    expect(parseMermaidToExcalidraw).toHaveBeenCalledOnce();
  });

  test.each([
    "flowchart TD\n A --> B",
    "sequenceDiagram\n A->>B: hello",
    "classDiagram\n class Animal",
    "erDiagram\n A ||--o{ B : has",
    "stateDiagram-v2\n [*] --> Idle",
  ])("allows every advertised editable diagram type", async (source) => {
    parseMermaidToExcalidraw.mockResolvedValue({ elements: flowchartSkeletons });
    expect(typeof (await convertMermaidToElements(source))).not.toBe("string");
    expect(parseMermaidToExcalidraw).toHaveBeenCalledOnce();
  });

  test("converts skeletons into editable elements with regenerated ids", async () => {
    parseMermaidToExcalidraw.mockResolvedValue({ elements: flowchartSkeletons });
    const result = await convertMermaidToElements("flowchart TD\n A --> B");
    expect(typeof result).not.toBe("string");
    const elements = result as readonly ExcalidrawElement[];
    expect(elements.length).toBe(3);
    expect(elements.map((el) => el.type).sort()).toEqual(["arrow", "rectangle", "rectangle"]);
    // No image fallback content sneaks through.
    expect(elements.every((el) => el.type !== "image")).toBe(true);
    // regenerateIds must mint fresh ids, not reuse Mermaid node names.
    const ids = elements.map((el) => el.id);
    expect(ids).not.toContain("A");
    expect(ids).not.toContain("B");
    expect(new Set(ids).size).toBe(3);
  });

  test("two conversions of the same source produce distinct ids", async () => {
    parseMermaidToExcalidraw.mockResolvedValue({ elements: flowchartSkeletons });
    const first = (await convertMermaidToElements("flowchart TD\n A --> B")) as readonly ExcalidrawElement[];
    const second = (await convertMermaidToElements("flowchart TD\n A --> B")) as readonly ExcalidrawElement[];
    const firstIds = new Set(first.map((el) => el.id));
    expect(second.every((el) => !firstIds.has(el.id))).toBe(true);
  });

  test("arrow bindings survive conversion", async () => {
    parseMermaidToExcalidraw.mockResolvedValue({ elements: flowchartSkeletons });
    const elements = (await convertMermaidToElements("flowchart TD\n A --> B")) as ExcalidrawElement[];
    const arrow = elements.find((el) => el.type === "arrow") as ExcalidrawElement & {
      startBinding: { elementId: string } | null;
      endBinding: { elementId: string } | null;
    };
    const rectIds = elements.filter((el) => el.type === "rectangle").map((el) => el.id);
    expect(arrow.startBinding?.elementId).toBe(rectIds[0]);
    expect(arrow.endBinding?.elementId).toBe(rectIds[1]);
  });

  test("rejects image fallback output (unsupported diagram types)", async () => {
    parseMermaidToExcalidraw.mockResolvedValue({
      elements: [{ type: "image", x: 0, y: 0, width: 400, height: 300, fileId: "f1" }],
      files: { f1: { mimeType: "image/svg+xml", dataURL: "data:image/svg+xml;base64,AAAA" } },
    });
    expect(await convertMermaidToElements("gantt\n title Plan")).toBe(MERMAID_NOT_EDITABLE_ERROR);
  });

  test("rejects output that only carries binary files", async () => {
    parseMermaidToExcalidraw.mockResolvedValue({
      elements: flowchartSkeletons,
      files: { f1: { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" } },
    });
    expect(await convertMermaidToElements("pie\n \"a\": 1")).toBe(MERMAID_NOT_EDITABLE_ERROR);
  });

  test("rejects empty converter output", async () => {
    parseMermaidToExcalidraw.mockResolvedValue({ elements: [] });
    expect(await convertMermaidToElements("flowchart TD")).toBe("The diagram produced no shapes.");
  });

  test("normalizes parse errors to their leading lines", async () => {
    parseMermaidToExcalidraw.mockRejectedValue(
      new Error("Parse error on line 2:\nA --> -->\n----------^\nExpecting 'ALPHA'\nlots\nof\nextra\ncontext"),
    );
    const result = await convertMermaidToElements("flowchart TD\n A --> -->");
    expect(result).toBe("Parse error on line 2:\nA --> -->\n----------^\nExpecting 'ALPHA'");
  });

  test("non-Error rejection becomes a generic message", async () => {
    parseMermaidToExcalidraw.mockRejectedValue("boom");
    expect(await convertMermaidToElements("flowchart TD\n A")).toBe("Could not parse the Mermaid diagram.");
  });

  test("a throw after parsing (malformed converter output) returns an error string instead of rejecting", async () => {
    // elements: undefined makes the fallback check throw. The whole
    // pipeline, not just the parse call, must resolve to an error string.
    parseMermaidToExcalidraw.mockResolvedValue({});
    const result = await convertMermaidToElements("flowchart TD\n A");
    expect(typeof result).toBe("string");
  });

  test("passes the trimmed source to the parser", async () => {
    parseMermaidToExcalidraw.mockResolvedValue({ elements: flowchartSkeletons });
    await convertMermaidToElements("  flowchart TD\n A --> B\n");
    expect(parseMermaidToExcalidraw).toHaveBeenCalledWith(
      "flowchart TD\n A --> B",
      expect.objectContaining({
        maxEdges: expect.any(Number),
        maxTextSize: expect.any(Number),
        securityLevel: "strict",
        secure: expect.arrayContaining(["securityLevel", "maxTextSize", "maxEdges"]),
      }),
    );
  });
});

describe("centerElementsOnFrame", () => {
  const frame = { x: 0, y: 0, width: 1600, height: 900 };

  function rect(x: number, y: number, width: number, height: number): ExcalidrawElement {
    return {
      id: Math.random().toString(36).slice(2),
      type: "rectangle",
      x,
      y,
      width,
      height,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
    } as unknown as ExcalidrawElement;
  }

  test("centers a single element on the frame", () => {
    const [placed] = centerElementsOnFrame([rect(0, 0, 100, 50)], frame);
    expect(placed.x).toBe(750);
    expect(placed.y).toBe(425);
  });

  test("translates a group rigidly, preserving relative offsets", () => {
    const placed = centerElementsOnFrame([rect(0, 0, 100, 50), rect(300, 200, 100, 50)], frame);
    // Combined bounds 400×250 centered on 1600×900 → shifted by (600, 325).
    expect(placed[0].x).toBe(600);
    expect(placed[0].y).toBe(325);
    expect(placed[1].x - placed[0].x).toBe(300);
    expect(placed[1].y - placed[0].y).toBe(200);
  });

  test("respects a moved frame origin", () => {
    const [placed] = centerElementsOnFrame([rect(0, 0, 100, 50)], { x: 1000, y: -500, width: 800, height: 450 });
    expect(placed.x).toBe(1000 + 400 - 50);
    expect(placed.y).toBe(-500 + 225 - 25);
  });

  test("empty input returns an empty array", () => {
    expect(centerElementsOnFrame([], frame)).toEqual([]);
  });
});
