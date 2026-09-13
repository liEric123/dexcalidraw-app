import { convertToExcalidrawElements, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { FrameBounds } from "../types/presentation";

// Generous ceiling for hand-written lesson diagrams; anything larger is almost
// certainly pasted by accident and would stall the converter.
export const MAX_MERMAID_SOURCE_LENGTH = 10_000;

// Passed straight to the converter. maxTextSize must cover the source ceiling
// above or mermaid rejects diagrams we consider valid.
const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict" as const,
  // Mermaid directives must not override the security and resource limits
  // supplied by the application.
  secure: [
    "secure",
    "securityLevel",
    "startOnLoad",
    "maxTextSize",
    "maxEdges",
    "dompurifyConfig",
    "themeCSS",
  ],
  maxEdges: 500,
  maxTextSize: MAX_MERMAID_SOURCE_LENGTH,
};

export const MERMAID_NOT_EDITABLE_ERROR =
  "This diagram type can only be rendered as an image, not editable shapes. Use a flowchart, sequence, class, ER, or state diagram instead.";

const MERMAID_DIRECTIVE_ERROR =
  "Mermaid configuration directives and frontmatter are not supported.";

function isEditableDiagramType(source: string): boolean {
  const firstContentLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("%%"));
  if (!firstContentLine) return false;
  return /^(?:flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram(?:-v2)?)\b/i.test(
    firstContentLine,
  );
}

function normalizeConverterError(err: unknown): string {
  const message = err instanceof Error ? err.message.trim() : "";
  if (!message) return "Could not parse the Mermaid diagram.";
  // Mermaid parse errors repeat the whole source with a caret; the first
  // lines carry the actual "Parse error on line N" description.
  const firstLines = message.split("\n").slice(0, 4).join("\n");
  return firstLines.length > 400 ? `${firstLines.slice(0, 400)}…` : firstLines;
}

/**
 * Convert Mermaid source into native, editable Excalidraw elements with fresh
 * ids. Returns a readable error string instead of throwing; image/SVG
 * fallback output (unsupported diagram types) is rejected.
 */
export async function convertMermaidToElements(
  source: string,
): Promise<readonly ExcalidrawElement[] | string> {
  const trimmed = source.trim();
  if (!trimmed) return "Enter a Mermaid diagram first.";
  if (trimmed.length > MAX_MERMAID_SOURCE_LENGTH) {
    return `Diagram source is too large (over ${MAX_MERMAID_SOURCE_LENGTH.toLocaleString()} characters).`;
  }
  // The converter renders Mermaid into this page's DOM before extracting
  // native shapes. Keep the rendering surface to the five editable formats,
  // and do not let source-level config alter the application policy.
  if (trimmed.startsWith("---") || /^\s*%%\s*\{/m.test(trimmed)) {
    return MERMAID_DIRECTIVE_ERROR;
  }
  if (!isEditableDiagramType(trimmed)) return MERMAID_NOT_EDITABLE_ERROR;

  // The whole load/parse/convert pipeline is inside the try: the dynamic
  // import can reject (e.g. offline) and the skeleton conversion can throw,
  // and this function's contract is to return an error string, never throw.
  try {
    // Dynamic import keeps mermaid (a large dependency) out of the editor's
    // initial bundle; it only loads the first time a diagram is converted.
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    const { elements: skeletons, files } = await parseMermaidToExcalidraw(trimmed, MERMAID_CONFIG);

    // Unsupported diagram types fall back to a rendered image (skeleton of
    // type "image" plus a binary file payload). Editability is the whole
    // point of this import, so reject rather than insert a bitmap.
    if (
      (files && Object.keys(files).length > 0) ||
      skeletons.some((el) => el.type === "image")
    ) {
      return MERMAID_NOT_EDITABLE_ERROR;
    }
    if (skeletons.length === 0) return "The diagram produced no shapes.";

    const elements = convertToExcalidrawElements(skeletons, { regenerateIds: true });
    if (elements.length === 0) return "The diagram produced no shapes.";
    return elements;
  } catch (err) {
    return normalizeConverterError(err);
  }
}

/**
 * Translate elements as a group so their combined bounding box is centered on
 * the given presentation frame. Pure translation: bindings, arrows, and
 * relative geometry are preserved.
 */
export function centerElementsOnFrame(
  elements: readonly ExcalidrawElement[],
  frame: FrameBounds,
): ExcalidrawElement[] {
  if (elements.length === 0) return [];
  const [minX, minY, maxX, maxY] = getCommonBounds(elements);
  const dx = frame.x + frame.width / 2 - (minX + maxX) / 2;
  const dy = frame.y + frame.height / 2 - (minY + maxY) / 2;
  return elements.map((el) => ({ ...el, x: el.x + dx, y: el.y + dy }));
}
