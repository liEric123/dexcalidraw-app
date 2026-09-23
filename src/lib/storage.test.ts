// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  validatePresentation,
  savePresentation,
  loadPresentationById,
  listPresentations,
  softDeletePresentation,
  restorePresentation,
  isTrashExpired,
  TRASH_RETENTION_MS,
} from "./storage";
import type { Presentation } from "../types/presentation";

function makeDeck(id: string, overrides: Partial<Presentation> = {}): Presentation {
  return {
    id,
    title: `Deck ${id}`,
    slides: [],
    currentSlideId: "",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("validatePresentation", () => {
  it("preserves notes drawings while dropping notes drawing appState", () => {
    const presentation = validatePresentation({
      id: "deck-1",
      title: "Deck",
      slides: [{
        id: "slide-1",
        title: "Slide 1",
        excalidrawData: { elements: [], appState: {}, files: {} },
        videoBlocks: [],
        notes: "",
        notesDrawing: {
          elements: [{ id: "note-rect", type: "rectangle", isDeleted: false }],
          appState: { collaborators: new Map(), zoom: { value: 2 } },
          files: { file1: { id: "file1" } },
        },
      }],
      currentSlideId: "slide-1",
      createdAt: 1,
      updatedAt: 2,
    });

    expect(presentation?.slides[0].notesDrawing?.elements).toHaveLength(1);
    expect(presentation?.slides[0].notesDrawing?.files).toHaveProperty("file1");
    expect(presentation?.slides[0].notesDrawing?.appState).toEqual({});
  });

  function slideWith(revealSteps: unknown) {
    return validatePresentation({
      id: "deck-1",
      title: "Deck",
      slides: [{
        id: "slide-1",
        title: "Slide 1",
        excalidrawData: { elements: [], appState: {}, files: {} },
        videoBlocks: [],
        notes: "",
        revealSteps,
      }],
      currentSlideId: "slide-1",
      createdAt: 1,
      updatedAt: 2,
    })?.slides[0].revealSteps;
  }

  it("preserves reveal steps across a load", () => {
    expect(slideWith([["a", "b"], ["c"]])).toEqual([["a", "b"], ["c"]]);
  });

  it("drops malformed reveal steps rather than failing the load", () => {
    expect(slideWith("nope")).toBeUndefined();
    expect(slideWith([[]])).toBeUndefined();
    expect(slideWith(undefined)).toBeUndefined();
    expect(slideWith([["a", 7], "x", ["b"]])).toEqual([["a"], ["b"]]);
  });

  it("leaves decks saved before reveal steps existed untouched", () => {
    expect(slideWith(undefined)).toBeUndefined();
  });

  it("preserves deletedAt across a load and drops a malformed value", () => {
    expect(validatePresentation(makeDeck("d1", { deletedAt: 123 }))?.deletedAt).toBe(123);
    expect(validatePresentation({ ...makeDeck("d2"), deletedAt: "nope" })?.deletedAt).toBeUndefined();
    expect(validatePresentation(makeDeck("d3"))?.deletedAt).toBeUndefined();
  });
});

describe("trash lifecycle", () => {
  beforeEach(() => localStorage.clear());

  it("softDeletePresentation stamps deletedAt without touching other fields", () => {
    savePresentation(makeDeck("d1", { title: "Keep me" }));
    expect(softDeletePresentation("d1")).toBe(true);
    const loaded = loadPresentationById("d1");
    expect(loaded?.title).toBe("Keep me");
    expect(loaded?.deletedAt).toBeGreaterThan(0);
  });

  it("softDeletePresentation returns false for a deck that doesn't exist", () => {
    expect(softDeletePresentation("missing")).toBe(false);
  });

  it("restorePresentation clears deletedAt", () => {
    savePresentation(makeDeck("d1"));
    softDeletePresentation("d1");
    expect(restorePresentation("d1")).toBe(true);
    expect(loadPresentationById("d1")?.deletedAt).toBeUndefined();
  });

  it("restorePresentation returns false for a deck that doesn't exist", () => {
    expect(restorePresentation("missing")).toBe(false);
  });

  it("listPresentations reports deletedAt so callers can filter trashed decks", () => {
    savePresentation(makeDeck("d1"));
    savePresentation(makeDeck("d2"));
    softDeletePresentation("d2");
    const metas = listPresentations();
    expect(metas.find((m) => m.id === "d1")?.deletedAt).toBeUndefined();
    expect(metas.find((m) => m.id === "d2")?.deletedAt).toBeGreaterThan(0);
  });

  it("isTrashExpired is false just under the retention window and true at/after it", () => {
    const deletedAt = 1_000_000;
    expect(isTrashExpired(deletedAt, deletedAt + TRASH_RETENTION_MS - 1)).toBe(false);
    expect(isTrashExpired(deletedAt, deletedAt + TRASH_RETENTION_MS)).toBe(true);
  });
});
