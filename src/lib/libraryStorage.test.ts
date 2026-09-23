import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadLibrary, saveLibrary, clearLibrary } from "./libraryStorage";
import type { LibraryItems } from "@excalidraw/excalidraw/types";

const KEY = "excalidraw-video-deck:library";

const mockItems: LibraryItems = [
  {
    id: "item-1",
    status: "published",
    elements: [],
    created: 1700000000000,
    name: "Test Item",
  },
];

// Minimal localStorage shim for Node test environment.
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string): string | null => store[k] ?? null,
  setItem: (k: string, v: string): void => { store[k] = v; },
  removeItem: (k: string): void => { delete store[k]; },
  clear: (): void => { for (const k of Object.keys(store)) delete store[k]; },
};
vi.stubGlobal("localStorage", localStorageMock);

beforeEach(() => {
  localStorageMock.clear();
});

describe("loadLibrary", () => {
  it("returns empty array when nothing stored", () => {
    expect(loadLibrary()).toEqual([]);
  });

  it("returns stored items", () => {
    localStorageMock.setItem(KEY, JSON.stringify(mockItems));
    expect(loadLibrary()).toEqual(mockItems);
  });

  it("returns empty array on corrupted JSON", () => {
    localStorageMock.setItem(KEY, "not-json{{");
    expect(loadLibrary()).toEqual([]);
  });

  it("returns empty array when stored value is not an array", () => {
    localStorageMock.setItem(KEY, JSON.stringify({ items: [] }));
    expect(loadLibrary()).toEqual([]);
  });

  it("filters out structurally invalid items", () => {
    const mixed = [
      { id: "good", status: "published", elements: [], created: 1 },
      { status: "published", elements: [], created: 1 },   // missing id
      { id: 42, elements: [] },                             // id not a string
      { id: "no-elements" },                               // missing elements array
      null,
      "not-an-object",
    ];
    localStorageMock.setItem(KEY, JSON.stringify(mixed));
    const result = loadLibrary();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "good" });
  });
});

describe("saveLibrary", () => {
  it("persists items to localStorage", () => {
    saveLibrary(mockItems);
    expect(JSON.parse(localStorageMock.getItem(KEY)!)).toEqual(mockItems);
  });

  it("overwrites previously stored items", () => {
    saveLibrary(mockItems);
    saveLibrary([]);
    expect(JSON.parse(localStorageMock.getItem(KEY)!)).toEqual([]);
  });

  it("throws when localStorage.setItem throws", () => {
    const spy = vi.spyOn(localStorageMock, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveLibrary(mockItems)).toThrow();
    spy.mockRestore();
  });
});

describe("clearLibrary", () => {
  it("removes the library key", () => {
    saveLibrary(mockItems);
    clearLibrary();
    expect(localStorageMock.getItem(KEY)).toBeNull();
  });

  it("is a no-op when nothing is stored", () => {
    expect(() => clearLibrary()).not.toThrow();
  });

  it("loadLibrary returns empty array after clear", () => {
    saveLibrary(mockItems);
    clearLibrary();
    expect(loadLibrary()).toEqual([]);
  });
});
