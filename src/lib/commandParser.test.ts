import { describe, test, expect } from "vitest";
import { parseCommand, getSuggestions } from "./commandParser";

describe("parseCommand", () => {
  test("pen uses current color and width", () => {
    expect(parseCommand("pen", "#e11d48", 2)).toEqual({ type: "pen", color: "#e11d48", width: 2 });
  });

  test("pen red overrides color", () => {
    expect(parseCommand("pen red", "#3b82f6", 2)).toEqual({ type: "pen", color: "#e11d48", width: 2 });
  });

  test("pen blue 4 sets color and width", () => {
    expect(parseCommand("pen blue 4", "#e11d48", 2)).toEqual({ type: "pen", color: "#3b82f6", width: 4 });
  });

  test("pen 4 sets width and keeps current color", () => {
    expect(parseCommand("pen 4", "#e11d48", 2)).toEqual({ type: "pen", color: "#e11d48", width: 4 });
  });

  test("pen with all valid colors", () => {
    expect(parseCommand("pen orange", "#e11d48", 2)).toEqual({ type: "pen", color: "#f97316", width: 2 });
    expect(parseCommand("pen yellow", "#e11d48", 2)).toEqual({ type: "pen", color: "#eab308", width: 2 });
    expect(parseCommand("pen green", "#e11d48", 2)).toEqual({ type: "pen", color: "#22c55e", width: 2 });
    expect(parseCommand("pen white", "#e11d48", 2)).toEqual({ type: "pen", color: "#ffffff", width: 2 });
  });

  test("highlight uses current color and width", () => {
    expect(parseCommand("highlight", "#e11d48", 2)).toEqual({ type: "highlight", color: "#e11d48", width: 2 });
  });

  test("highlight yellow overrides color", () => {
    expect(parseCommand("highlight yellow", "#e11d48", 2)).toEqual({ type: "highlight", color: "#eab308", width: 2 });
  });

  test("highlight yellow 4 sets color and width", () => {
    expect(parseCommand("highlight yellow 4", "#e11d48", 2)).toEqual({ type: "highlight", color: "#eab308", width: 4 });
  });

  test("highlight with unrecognized color returns null", () => {
    expect(parseCommand("highlight purple", "#e11d48", 2)).toBeNull();
  });

  test("highlight with duplicate colors returns null", () => {
    expect(parseCommand("highlight red blue", "#e11d48", 2)).toBeNull();
  });

  test("highlight with invalid width returns null", () => {
    expect(parseCommand("highlight 3", "#e11d48", 2)).toBeNull();
  });

  test("laser", () => {
    expect(parseCommand("laser", "#e11d48", 2)).toEqual({ type: "laser" });
  });

  test("clear", () => {
    expect(parseCommand("clear", "#e11d48", 2)).toEqual({ type: "clear" });
  });

  test("undo", () => {
    expect(parseCommand("undo", "#e11d48", 2)).toEqual({ type: "undo" });
  });

  test("off", () => {
    expect(parseCommand("off", "#e11d48", 2)).toEqual({ type: "off" });
  });

  test("goto without args opens overview", () => {
    expect(parseCommand("goto", "#e11d48", 2)).toEqual({ type: "goto" });
  });

  test("goto with slide number", () => {
    expect(parseCommand("goto 3", "#e11d48", 2)).toEqual({ type: "goto", slide: 3 });
    expect(parseCommand("goto 1", "#e11d48", 2)).toEqual({ type: "goto", slide: 1 });
  });

  test("goto 0 returns null", () => {
    expect(parseCommand("goto 0", "#e11d48", 2)).toBeNull();
  });

  test("goto with non-numeric arg returns null", () => {
    expect(parseCommand("goto x", "#e11d48", 2)).toBeNull();
    expect(parseCommand("goto -1", "#e11d48", 2)).toBeNull();
    expect(parseCommand("goto 1.5", "#e11d48", 2)).toBeNull();
  });

  test("goto with two args returns null", () => {
    expect(parseCommand("goto 1 2", "#e11d48", 2)).toBeNull();
  });

  test("unknown command returns null", () => {
    expect(parseCommand("foo", "#e11d48", 2)).toBeNull();
  });

  test("pen with unrecognized color returns null", () => {
    expect(parseCommand("pen purple", "#e11d48", 2)).toBeNull();
  });

  test("pen with unrecognized width returns null", () => {
    expect(parseCommand("pen 3", "#e11d48", 2)).toBeNull();
  });

  test("pen with duplicate colors returns null", () => {
    expect(parseCommand("pen red blue", "#e11d48", 2)).toBeNull();
  });

  test("pen with duplicate widths returns null", () => {
    expect(parseCommand("pen 1 2", "#e11d48", 2)).toBeNull();
  });

  test("laser with extra arg returns null", () => {
    expect(parseCommand("laser on", "#e11d48", 2)).toBeNull();
  });

  test("clear with extra arg returns null", () => {
    expect(parseCommand("clear all", "#e11d48", 2)).toBeNull();
  });

  test("undo with extra arg returns null", () => {
    expect(parseCommand("undo stroke", "#e11d48", 2)).toBeNull();
  });

  test("off with extra arg returns null", () => {
    expect(parseCommand("off now", "#e11d48", 2)).toBeNull();
  });

  test("case insensitive", () => {
    expect(parseCommand("PEN RED", "#3b82f6", 2)).toEqual({ type: "pen", color: "#e11d48", width: 2 });
    expect(parseCommand("LASER", "#e11d48", 2)).toEqual({ type: "laser" });
  });

  test("trims leading and trailing whitespace", () => {
    expect(parseCommand("  pen  red  ", "#3b82f6", 2)).toEqual({ type: "pen", color: "#e11d48", width: 2 });
  });

  test("empty string returns null", () => {
    expect(parseCommand("", "#e11d48", 2)).toBeNull();
  });

  test("whitespace-only string returns null", () => {
    expect(parseCommand("   ", "#e11d48", 2)).toBeNull();
  });

  test("mermaid is not a presenter command", () => {
    expect(parseCommand("mermaid", "#e11d48", 2)).toBeNull();
    expect(parseCommand("mermaid", "#e11d48", 2, "present")).toBeNull();
  });
});

describe("parseCommand in editor context", () => {
  test("mermaid parses", () => {
    expect(parseCommand("mermaid", "#e11d48", 2, "editor")).toEqual({ type: "mermaid" });
    expect(parseCommand("reveal", "#e11d48", 2, "editor")).toEqual({ type: "reveal" });
    expect(parseCommand("  REVEAL ", "#e11d48", 2, "editor")).toEqual({ type: "reveal" });
  });

  test("case insensitive with surrounding whitespace", () => {
    expect(parseCommand("  MERMAID  ", "#e11d48", 2, "editor")).toEqual({ type: "mermaid" });
  });

  test("mermaid with extra arg returns null", () => {
    expect(parseCommand("mermaid now", "#e11d48", 2, "editor")).toBeNull();
    expect(parseCommand("reveal now", "#e11d48", 2, "editor")).toBeNull();
  });

  test("presenter commands are rejected", () => {
    expect(parseCommand("pen", "#e11d48", 2, "editor")).toBeNull();
    expect(parseCommand("goto 2", "#e11d48", 2, "editor")).toBeNull();
    expect(parseCommand("laser", "#e11d48", 2, "editor")).toBeNull();
  });

  test("empty string returns null", () => {
    expect(parseCommand("", "#e11d48", 2, "editor")).toBeNull();
  });
});

describe("getSuggestions", () => {
  const base = { inkMode: false, inkHighlight: false, laserMode: false, inkColor: "#e11d48", inkStrokeWidth: 2 };

  test("empty input returns exactly 7 top-level commands", () => {
    const s = getSuggestions("", base);
    expect(s.map((x) => x.text)).toEqual(["pen", "highlight", "laser", "goto", "clear", "undo", "off"]);
  });

  test("'g' prefix returns goto with usage hint", () => {
    const s = getSuggestions("g", base);
    expect(s).toHaveLength(1);
    expect(s[0].text).toBe("goto");
    expect(s[0].hint).toBe("(overview, or goto [n])");
  });

  test("'p' prefix returns only pen entries", () => {
    const s = getSuggestions("p", base);
    expect(s.every((x) => x.text.startsWith("p"))).toBe(true);
    expect(s[0].text).toBe("pen");
  });

  test("'l' prefix returns only laser", () => {
    const s = getSuggestions("l", base);
    expect(s).toHaveLength(1);
    expect(s[0].text).toBe("laser");
  });

  test("'pen r' returns suggestions starting with pen r", () => {
    const s = getSuggestions("pen r", base);
    expect(s.every((x) => x.text.startsWith("pen r"))).toBe(true);
    expect(s.some((x) => x.text === "pen red")).toBe(true);
  });

  test("'pen ' returns color and width suggestions", () => {
    const s = getSuggestions("pen ", base);
    expect(s.some((x) => x.text === "pen red")).toBe(true);
    expect(s.some((x) => x.text === "pen 4")).toBe(true);
  });

  test("'pen blue ' returns width suggestions", () => {
    const s = getSuggestions("pen blue ", base);
    expect(s.every((x) => x.text.startsWith("pen blue "))).toBe(true);
    expect(s.some((x) => x.text === "pen blue 4")).toBe(true);
  });

  test("no match returns empty array", () => {
    expect(getSuggestions("xyz", base)).toEqual([]);
  });

  test("returns at most 9 suggestions", () => {
    const s = getSuggestions("pen ", base);
    expect(s.length).toBeLessThanOrEqual(9);
  });

  test("shows inkMode hint on pen when ink is active", () => {
    const s = getSuggestions("", { ...base, inkMode: true });
    const pen = s.find((x) => x.text === "pen");
    expect(pen?.hint).toContain("red");
    expect(pen?.hint).toContain("2");
  });

  test("no hint on pen when ink is off", () => {
    const s = getSuggestions("", base);
    expect(s.find((x) => x.text === "pen")?.hint).toBeUndefined();
  });

  test("shows (active) on laser when laser is on", () => {
    const s = getSuggestions("", { ...base, laserMode: true });
    expect(s.find((x) => x.text === "laser")?.hint).toBe("(active)");
  });

  test("no hint on laser when laser is off", () => {
    const s = getSuggestions("", base);
    expect(s.find((x) => x.text === "laser")?.hint).toBeUndefined();
  });

  test("shows (current) hint on active color when ink is on", () => {
    // inkColor is red (#e11d48), so "pen red" should get (current)
    const s = getSuggestions("pen ", { ...base, inkMode: true });
    const penRed = s.find((x) => x.text === "pen red");
    expect(penRed?.hint).toBe("(current)");
  });

  test("'h' prefix returns highlight entries", () => {
    const s = getSuggestions("h", base);
    expect(s.every((x) => x.text.startsWith("h"))).toBe(true);
    expect(s[0].text).toBe("highlight");
    expect(s.some((x) => x.text === "highlight yellow")).toBe(true);
  });

  test("highlighter active shows hint on highlight, not pen", () => {
    const s = getSuggestions("", { ...base, inkMode: true, inkHighlight: true });
    expect(s.find((x) => x.text === "highlight")?.hint).toContain("red");
    expect(s.find((x) => x.text === "pen")?.hint).toBeUndefined();
  });

  test("pen active shows hint on pen, not highlight", () => {
    const s = getSuggestions("", { ...base, inkMode: true });
    expect(s.find((x) => x.text === "pen")?.hint).toContain("red");
    expect(s.find((x) => x.text === "highlight")?.hint).toBeUndefined();
  });

  test("shows (current) hint on active color when highlighter is on", () => {
    const s = getSuggestions("highlight ", { ...base, inkMode: true, inkHighlight: true });
    expect(s.find((x) => x.text === "highlight red")?.hint).toBe("(current)");
  });

  test("presenter suggestions never include mermaid", () => {
    expect(getSuggestions("m", base)).toEqual([]);
  });

  describe("editor context", () => {
    test("empty input lists the editor commands", () => {
      expect(getSuggestions("", base, "editor").map((x) => x.text)).toEqual(["mermaid", "reveal"]);
    });

    test("prefix matches mermaid", () => {
      const s = getSuggestions("mer", base, "editor");
      expect(s).toHaveLength(1);
      expect(s[0].text).toBe("mermaid");
    });

    test("prefix matches reveal", () => {
      const s = getSuggestions("rev", base, "editor");
      expect(s).toHaveLength(1);
      expect(s[0].text).toBe("reveal");
    });

    test("presenter commands do not match", () => {
      expect(getSuggestions("pen", base, "editor")).toEqual([]);
    });
  });
});
