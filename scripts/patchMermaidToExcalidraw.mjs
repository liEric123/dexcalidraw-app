import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = resolve("node_modules/@excalidraw/mermaid-to-excalidraw/dist/parser");

function patchFile(fileName, replacements) {
  const path = resolve(packageRoot, fileName);
  let source = readFileSync(path, "utf8");

  for (const { before, after } of replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) {
      throw new Error(
        `Cannot patch ${fileName}: @excalidraw/mermaid-to-excalidraw changed unexpectedly. ` +
          "Review this compatibility patch before updating the package.",
      );
    }
    source = source.replace(before, after);
  }

  writeFileSync(path, source);
}

// Mermaid 11.15+ prefixes rendered SVG ids with the render id. Converter
// 2.2.2 still expects several class/ER/state ids to match parser metadata
// exactly, so those formats otherwise fall back to an uneditable image.
patchFile("class.js", [
  {
    before: "const regex = new RegExp(`^classId-${id}(?:-|$)`);",
    after:
      "const escapedId = id.replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\");\n" +
      "            const regex = new RegExp(`(?:^|-)classId-${escapedId}(?:-|$)`);",
  },
]);

patchFile("er.js", [
  {
    before: "const getRelationshipPaths = (edge, containerEl) => {",
    after:
      "const findByRenderedId = (containerEl, id, tagName) => Array.from(containerEl.querySelectorAll(`${tagName}[id]`)).find((element) => element.id === id || element.id.endsWith(`-${id}`)) || null;\n" +
      "const getRelationshipPaths = (edge, containerEl) => {",
  },
  {
    before: "const directPath = containerEl.querySelector(`path[id=\"${edge.id}\"][data-edge=\"true\"]`);",
    after: "const directPath = findByRenderedId(containerEl, edge.id, \"path\");",
  },
  {
    before:
      ".map((pathId) => containerEl.querySelector(`path[id=\"${pathId}\"][data-edge=\"true\"]`))",
    after: ".map((pathId) => findByRenderedId(containerEl, pathId, \"path\"))",
  },
  {
    before: "const domNode = containerEl.querySelector(`[id=\"${entity.id}\"]`);",
    after: "const domNode = findByRenderedId(containerEl, entity.id, \"g\");",
  },
]);

patchFile("state.js", [
  {
    before: `        const selectors = [
            \`[id='\${node.domId}']\`,
            \`[id='\${node.id}']\`,
            \`[data-id='\${node.id}']\`,
        ];
        for (const selector of selectors) {
            const element = containerEl.querySelector(selector);
            if (element) {
                return markAndReturn(element);
            }
        }`,
    after: `        const ids = [node.domId, node.id].filter(Boolean);
        for (const id of ids) {
            const element = Array.from(containerEl.querySelectorAll("[id]")).find((candidate) => candidate.id === id || candidate.id.endsWith(\`-\${id}\`));
            if (element) {
                return markAndReturn(element);
            }
        }
        const dataIdElement = Array.from(containerEl.querySelectorAll("[data-id]")).find((candidate) => candidate.getAttribute("data-id") === node.id);
        if (dataIdElement) {
            return markAndReturn(dataIdElement);
        }`,
  },
  {
    before: "const edgeEl = containerEl.querySelector(`[id='${edge.id}']`);",
    after:
      "const edgeEl = Array.from(containerEl.querySelectorAll(\"[id]\")).find((candidate) => candidate.id === edge.id || candidate.id.endsWith(`-${edge.id}`));",
  },
]);
