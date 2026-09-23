import { describe, it, expect } from "vitest";
import { FONT_SIZES, stepFontSize } from "./fontSizes";

describe("stepFontSize", () => {
  it("steps up from an exact match", () => {
    expect(stepFontSize(20, 1)).toBe(28);
    expect(stepFontSize(12, 1)).toBe(16);
  });

  it("steps down from an exact match", () => {
    expect(stepFontSize(28, -1)).toBe(20);
    expect(stepFontSize(16, -1)).toBe(12);
  });

  it("round-trips up then down", () => {
    expect(stepFontSize(stepFontSize(20, 1), -1)).toBe(20);
  });

  it("clamps at maximum", () => {
    const max = FONT_SIZES[FONT_SIZES.length - 1];
    expect(stepFontSize(max, 1)).toBe(max);
  });

  it("clamps at minimum", () => {
    expect(stepFontSize(FONT_SIZES[0], -1)).toBe(FONT_SIZES[0]);
  });

  it("snaps a non-preset size to the next slot when stepping up", () => {
    expect(stepFontSize(22, 1)).toBe(28);
  });

  it("snaps a non-preset size to the lower slot when stepping down", () => {
    expect(stepFontSize(22, -1)).toBe(20);
  });

  it("handles a size larger than all presets when stepping up", () => {
    const max = FONT_SIZES[FONT_SIZES.length - 1];
    expect(stepFontSize(200, 1)).toBe(max);
  });

  it("handles a size larger than all presets when stepping down", () => {
    expect(stepFontSize(200, -1)).toBe(FONT_SIZES[FONT_SIZES.length - 1]);
  });

  it("clamps a size smaller than all presets", () => {
    expect(stepFontSize(8, 1)).toBe(FONT_SIZES[0]);
    expect(stepFontSize(8, -1)).toBe(FONT_SIZES[0]);
  });
});
