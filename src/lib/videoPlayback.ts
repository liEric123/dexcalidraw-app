// Pure helpers shared by the editor video transport and presentation playback.
// The <video> element remains the source of truth for time/paused state;
// these functions only compute values from block metadata and media state.

export type TrimBounds = {
  start: number;
  /** Effective trim end, defined only when trimEnd is set and after start. */
  end?: number;
};

type TrimFields = { trimStart?: number; trimEnd?: number };

export function getTrimBounds(block: TrimFields): TrimBounds {
  const start = block.trimStart ?? 0;
  const end =
    block.trimEnd !== undefined && block.trimEnd > start ? block.trimEnd : undefined;
  return { start, end };
}

// Clamp a playback time into [start, end ?? duration]. A missing/NaN duration
// (metadata not loaded) leaves the upper bound at trim end only.
export function clampToPlayableRange(
  time: number,
  bounds: TrimBounds,
  duration?: number
): number {
  let max = bounds.end;
  if (max === undefined && duration !== undefined && Number.isFinite(duration)) {
    max = duration;
  }
  const upper = max !== undefined ? Math.max(bounds.start, max) : Infinity;
  return Math.min(upper, Math.max(bounds.start, time));
}

// Where playback should resume when the user presses play: back at trim start
// when sitting at/after the effective end (trim end, or media end), otherwise
// the current position. Prevents "play → instantly re-paused at trim end".
export function playbackResumeTime(
  time: number,
  bounds: TrimBounds,
  duration?: number,
  ended = false
): number {
  let end = bounds.end;
  if (end === undefined && duration !== undefined && Number.isFinite(duration)) {
    end = duration;
  }
  if (ended || (end !== undefined && time >= end)) return bounds.start;
  return time;
}

// Breakpoints that can actually pause playback: strictly inside the trimmed
// range, deduplicated and sorted.
export function effectiveBreakpoints(
  block: TrimFields & { breakpoints?: number[] }
): number[] {
  const { start, end } = getTrimBounds(block);
  return [...new Set(block.breakpoints ?? [])]
    .filter((bp) => bp > start && (end === undefined || bp < end))
    .sort((a, b) => a - b);
}

// Index of the next breakpoint after `time` in a sorted list; list.length when
// every breakpoint is behind the current time.
export function nextBreakpointIndex(sorted: number[], time: number): number {
  const index = sorted.findIndex((bp) => bp > time);
  return index === -1 ? sorted.length : index;
}

// Add a breakpoint at `time`, or remove an existing one within `tolerance`
// seconds of it. Returns undefined when the resulting list is empty, matching
// how VideoBlock.breakpoints is persisted.
export function toggleBreakpoint(
  breakpoints: number[] | undefined,
  time: number,
  tolerance = 0.25
): number[] | undefined {
  const existing = breakpoints ?? [];
  const kept = existing.filter((bp) => Math.abs(bp - time) > tolerance);
  if (kept.length < existing.length) {
    return kept.length > 0 ? kept : undefined;
  }
  if (time <= 0) return existing.length > 0 ? [...existing] : undefined;
  return [...existing, time].sort((a, b) => a - b);
}

// "m:ss" (or "h:mm:ss"); tenths appends ".d" for precise trim/breakpoint work.
export function formatTime(seconds: number, opts?: { tenths?: boolean }): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const base =
    h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  if (!opts?.tenths) return base;
  const tenth = Math.floor((seconds - whole) * 10);
  return `${base}.${tenth}`;
}

// Readable message for HTMLMediaElement.error.
export function describeMediaError(error: { code: number } | null | undefined): string {
  switch (error?.code) {
    case 1: // MEDIA_ERR_ABORTED
      return "Playback was aborted.";
    case 2: // MEDIA_ERR_NETWORK
      return "A network error interrupted playback.";
    case 3: // MEDIA_ERR_DECODE
      return "This video could not be decoded.";
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return "This video format is not supported.";
    default:
      return "Video playback failed.";
  }
}
