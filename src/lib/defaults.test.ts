import { describe, expect, it } from "vitest";
import type { Presentation } from "../types/presentation";
import { createDemoPresentation, createPresentationFromTemplate } from "./defaults";

function templatePresentation(): Presentation {
  return {
    id: "template-1",
    title: "Lesson template",
    slides: [{
      id: "slide-1",
      title: "Intro",
      excalidrawData: {
        elements: [],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      },
      videoBlocks: [{
        id: "video-1",
        name: "demo.webm",
        src: "",
        fileName: "demo.webm",
        mimeType: "video/webm",
        x: 0.1,
        y: 0.2,
        width: 0.4,
        height: 0.3,
        objectFit: "contain",
        breakpoints: [2, 4],
        autoplay: false,
        loop: false,
        muted: true,
      }],
      notes: "Explain the setup",
      presentationFrame: { x: 0, y: 0, width: 1600, height: 900 },
      revealSteps: [["el-a"], ["el-b"]],
    }],
    currentSlideId: "slide-1",
    createdAt: 1,
    updatedAt: 2,
    isTemplate: true,
  };
}

describe("createPresentationFromTemplate", () => {
  it("creates a regular deck with fresh ids and independent nested data", () => {
    const template = templatePresentation();
    const { presentation, videoIdPairs } = createPresentationFromTemplate(template, true);

    expect(presentation.id).not.toBe(template.id);
    expect(presentation.isTemplate).toBe(false);
    expect(presentation.slides[0].id).not.toBe(template.slides[0].id);
    expect(presentation.currentSlideId).toBe(presentation.slides[0].id);
    expect(presentation.slides[0].notes).toBe("Explain the setup");
    expect(presentation.slides[0].videoBlocks[0].id).not.toBe("video-1");
    expect(presentation.slides[0].videoBlocks[0].src).toBe("");
    expect(videoIdPairs).toEqual([{
      oldId: "video-1",
      newId: presentation.slides[0].videoBlocks[0].id,
    }]);

    presentation.slides[0].videoBlocks[0].breakpoints?.push(6);
    expect(template.slides[0].videoBlocks[0].breakpoints).toEqual([2, 4]);

    // Element ids are preserved by the clone, so the copy's steps still point
    // at real shapes, but the arrays must not be shared with the template.
    expect(presentation.slides[0].revealSteps).toEqual([["el-a"], ["el-b"]]);
    presentation.slides[0].revealSteps![0].push("el-z");
    expect(template.slides[0].revealSteps).toEqual([["el-a"], ["el-b"]]);
  });

  it("keeps video placeholders but removes stale file labels", () => {
    const { presentation } = createPresentationFromTemplate(templatePresentation(), false);
    const block = presentation.slides[0].videoBlocks[0];

    expect(block.name).toBe("Video");
    expect(block.fileName).toBeUndefined();
    expect(block.mimeType).toBeUndefined();
    expect(block.x).toBe(0.1);
    expect(block.breakpoints).toEqual([2, 4]);
  });

  it("supports an empty template", () => {
    const template = { ...templatePresentation(), slides: [], currentSlideId: "" };
    const { presentation, videoIdPairs } = createPresentationFromTemplate(template, false);

    expect(presentation.slides).toEqual([]);
    expect(presentation.currentSlideId).toBe("");
    expect(videoIdPairs).toEqual([]);
  });
});

describe("createDemoPresentation", () => {
  it("builds a self-consistent showcase deck with no video blocks", () => {
    const demo = createDemoPresentation();

    expect(demo.slides.length).toBeGreaterThan(0);
    expect(demo.currentSlideId).toBe(demo.slides[0].id);
    for (const slide of demo.slides) {
      expect(slide.videoBlocks).toEqual([]);
    }

    const allIds = demo.slides.flatMap((s) => s.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("every reveal-step id resolves to a real element on its slide, with no duplicates", () => {
    const demo = createDemoPresentation();

    for (const slide of demo.slides) {
      if (!slide.revealSteps) continue;
      const elementIds = new Set(slide.excalidrawData.elements.map((el) => el.id));
      const stepIds = slide.revealSteps.flat();

      for (const id of stepIds) {
        expect(elementIds.has(id)).toBe(true);
      }
      expect(new Set(stepIds).size).toBe(stepIds.length);
    }
  });

  it("gives every element on every slide a unique id", () => {
    const demo = createDemoPresentation();

    for (const slide of demo.slides) {
      const ids = slide.excalidrawData.elements.map((el) => el.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
