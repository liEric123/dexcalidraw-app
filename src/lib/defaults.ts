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
