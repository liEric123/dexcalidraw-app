import { describe, expect, it } from "vitest";
import {
  clampToPlayableRange,
  describeMediaError,
  effectiveBreakpoints,
  formatTime,
  getTrimBounds,
  nextBreakpointIndex,
  playbackResumeTime,
  toggleBreakpoint,
} from "./videoPlayback";

describe("getTrimBounds", () => {
  it("defaults to start 0 with no end", () => {
    expect(getTrimBounds({})).toEqual({ start: 0, end: undefined });
  });

  it("uses trimStart and a trimEnd after it", () => {
    expect(getTrimBounds({ trimStart: 1.5, trimEnd: 4 })).toEqual({ start: 1.5, end: 4 });
  });

  it("ignores a trimEnd at or before trimStart", () => {
    expect(getTrimBounds({ trimStart: 3, trimEnd: 2 })).toEqual({ start: 3, end: undefined });
    expect(getTrimBounds({ trimStart: 3, trimEnd: 3 })).toEqual({ start: 3, end: undefined });
  });
});

describe("clampToPlayableRange", () => {
  it("clamps below trim start", () => {
    expect(clampToPlayableRange(0.5, { start: 2 }, 10)).toBe(2);
  });

  it("clamps above trim end", () => {
    expect(clampToPlayableRange(9, { start: 1, end: 5 }, 10)).toBe(5);
  });

  it("falls back to duration when there is no trim end", () => {
    expect(clampToPlayableRange(20, { start: 0 }, 10)).toBe(10);
  });

  it("leaves time unbounded above without trim end or finite duration", () => {
    expect(clampToPlayableRange(42, { start: 1 }, NaN)).toBe(42);
    expect(clampToPlayableRange(42, { start: 1 })).toBe(42);
  });

  it("never returns less than start even for inverted bounds", () => {
    expect(clampToPlayableRange(5, { start: 8 }, 6)).toBe(8);
  });
});

describe("playbackResumeTime", () => {
  it("stays put while inside the playable range", () => {
    expect(playbackResumeTime(3, { start: 1, end: 5 }, 10)).toBe(3);
  });

  it("returns to trim start when at or past trim end", () => {
    expect(playbackResumeTime(5, { start: 1, end: 5 }, 10)).toBe(1);
    expect(playbackResumeTime(5.2, { start: 1, end: 5 }, 10)).toBe(1);
  });

  it("returns to trim start at media end when there is no trim end", () => {
    expect(playbackResumeTime(10, { start: 1 }, 10)).toBe(1);
    expect(playbackResumeTime(2, { start: 1 }, 10, true)).toBe(1);
  });

  it("stays put with unknown duration and no trim end", () => {
    expect(playbackResumeTime(7, { start: 0 }, NaN)).toBe(7);
    expect(playbackResumeTime(7, { start: 0 })).toBe(7);
  });
});

describe("effectiveBreakpoints", () => {
  it("keeps only breakpoints strictly inside the trim range, sorted and deduped", () => {
    expect(
      effectiveBreakpoints({ breakpoints: [5, 1, 3, 3, 0.5], trimStart: 1, trimEnd: 5 })
    ).toEqual([3]);
  });

  it("returns everything after start when no trim end", () => {
    expect(effectiveBreakpoints({ breakpoints: [4, 2] })).toEqual([2, 4]);
  });

  it("returns [] without breakpoints", () => {
    expect(effectiveBreakpoints({})).toEqual([]);
  });
});

describe("nextBreakpointIndex", () => {
  const bps = [2, 4, 6];

  it("points at the first breakpoint ahead of the current time", () => {
    expect(nextBreakpointIndex(bps, 0)).toBe(0);
    expect(nextBreakpointIndex(bps, 2)).toBe(1);
    expect(nextBreakpointIndex(bps, 5)).toBe(2);
  });

  it("returns list length when every breakpoint is behind", () => {
    expect(nextBreakpointIndex(bps, 6)).toBe(3);
    expect(nextBreakpointIndex([], 1)).toBe(0);
  });
});

describe("toggleBreakpoint", () => {
  it("adds a breakpoint in sorted position", () => {
    expect(toggleBreakpoint([1, 5], 3)).toEqual([1, 3, 5]);
  });

  it("removes an existing breakpoint within tolerance", () => {
    expect(toggleBreakpoint([1, 3, 5], 3.2)).toEqual([1, 5]);
  });

  it("returns undefined when removal empties the list", () => {
    expect(toggleBreakpoint([2], 2)).toBeUndefined();
  });

  it("does not add non-positive times", () => {
    expect(toggleBreakpoint(undefined, 0)).toBeUndefined();
    expect(toggleBreakpoint([4], -1)).toEqual([4]);
  });
});

describe("formatTime", () => {
  it("formats minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });

  it("formats hours", () => {
    expect(formatTime(3661)).toBe("1:01:01");
  });

  it("treats NaN, Infinity, and negatives as zero", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(-5)).toBe("0:00");
  });

  it("appends tenths on request", () => {
    expect(formatTime(2.57, { tenths: true })).toBe("0:02.5");
    expect(formatTime(0, { tenths: true })).toBe("0:00.0");
  });
});

describe("describeMediaError", () => {
  it("maps known MediaError codes", () => {
    expect(describeMediaError({ code: 1 })).toBe("Playback was aborted.");
    expect(describeMediaError({ code: 2 })).toBe("A network error interrupted playback.");
    expect(describeMediaError({ code: 3 })).toBe("This video could not be decoded.");
    expect(describeMediaError({ code: 4 })).toBe("This video format is not supported.");
  });

  it("falls back for unknown or missing errors", () => {
    expect(describeMediaError({ code: 99 })).toBe("Video playback failed.");
    expect(describeMediaError(null)).toBe("Video playback failed.");
  });
});
