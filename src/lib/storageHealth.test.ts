// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { getStorageEstimate, getStorageLevel, formatBytes } from "./storageHealth";

describe("getStorageLevel", () => {
  it("is ok below the warning threshold", () => {
    expect(getStorageLevel(0)).toBe("ok");
    expect(getStorageLevel(0.79)).toBe("ok");
  });

  it("is warning at/above the warning threshold and below critical", () => {
    expect(getStorageLevel(0.8)).toBe("warning");
    expect(getStorageLevel(0.94)).toBe("warning");
  });

  it("is critical at/above the critical threshold", () => {
    expect(getStorageLevel(0.95)).toBe("critical");
    expect(getStorageLevel(1)).toBe("critical");
  });
});

describe("formatBytes", () => {
  it("formats zero and negative as 0 B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });

  it("formats whole bytes and kilobytes without decimals over 10 units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(20 * 1024)).toBe("20 KB");
  });

  it("keeps one decimal place under 10 units", () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  it("scales up to GB", () => {
    expect(formatBytes(3.4 * 1024 * 1024 * 1024)).toBe("3.4 GB");
  });
});

describe("getStorageEstimate", () => {
  const originalStorage = navigator.storage;

  afterEach(() => {
    Object.defineProperty(navigator, "storage", { value: originalStorage, configurable: true });
  });

  it("returns null when the API is unsupported", async () => {
    Object.defineProperty(navigator, "storage", { value: undefined, configurable: true });
    expect(await getStorageEstimate()).toBeNull();
  });

  it("returns null when quota is missing or zero", async () => {
    Object.defineProperty(navigator, "storage", {
      value: { estimate: vi.fn(async () => ({ usage: 100, quota: 0 })) },
      configurable: true,
    });
    expect(await getStorageEstimate()).toBeNull();
  });

  it("computes percentUsed from usage and quota", async () => {
    Object.defineProperty(navigator, "storage", {
      value: { estimate: vi.fn(async () => ({ usage: 50, quota: 200 })) },
      configurable: true,
    });
    expect(await getStorageEstimate()).toEqual({ usage: 50, quota: 200, percentUsed: 0.25 });
  });

  it("treats a missing usage field as zero", async () => {
    Object.defineProperty(navigator, "storage", {
      value: { estimate: vi.fn(async () => ({ quota: 200 })) },
      configurable: true,
    });
    expect(await getStorageEstimate()).toEqual({ usage: 0, quota: 200, percentUsed: 0 });
  });

  it("returns null when estimate() rejects", async () => {
    Object.defineProperty(navigator, "storage", {
      value: { estimate: vi.fn(async () => { throw new Error("nope"); }) },
      configurable: true,
    });
    expect(await getStorageEstimate()).toBeNull();
  });
});
