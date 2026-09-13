import { useRef, useEffect, useState, useCallback } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  MoreVertical,
  Loader2,
} from "lucide-react";
import type { VideoBlock } from "../types/presentation";
import {
  getTrimBounds,
  effectiveBreakpoints,
  nextBreakpointIndex,
  playbackResumeTime,
  toggleBreakpoint,
  formatTime,
  describeMediaError,
} from "../lib/videoPlayback";

type Props = {
  block: VideoBlock;
  containerWidth: number;
  containerHeight: number;
  selected: boolean;
  mode: "editor" | "present";
  onSelect?: () => void;
  onUpdate?: (patch: Partial<VideoBlock>) => void;
  onDelete?: () => void;
  onFill?: () => void;
  /** A video write is already in flight; the fill placeholder must not start another. */
  fillPending?: boolean;
};

type TrimFields = Pick<VideoBlock, "trimStart" | "trimEnd" | "breakpoints" | "loop">;

// Pause at each breakpoint and stop (or loop) at trim end. Shared between the
// presentation player and the editor preview so both behave identically.
// Returns a cleanup function, or undefined when there is nothing to enforce.
function enforceTrimAndBreakpoints(
  video: HTMLVideoElement,
  fields: TrimFields
): (() => void) | undefined {
  const bounds = getTrimBounds(fields);
  const bps = effectiveBreakpoints(fields);
  if (bps.length === 0 && bounds.end === undefined) return undefined;

  let nextBpIdx = nextBreakpointIndex(bps, video.currentTime);

  const onTimeUpdate = () => {
    if (nextBpIdx < bps.length && video.currentTime >= bps[nextBpIdx]) {
      video.pause();
      nextBpIdx++;
      return;
    }
    if (bounds.end !== undefined && video.currentTime >= bounds.end) {
      if (fields.loop) {
        video.currentTime = bounds.start;
        nextBpIdx = nextBreakpointIndex(bps, bounds.start);
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  };

  // After a seek (J/L, scrubbing), recalculate which breakpoint is next.
  const onSeeked = () => {
    nextBpIdx = nextBreakpointIndex(bps, video.currentTime);
  };

  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("seeked", onSeeked);
  return () => {
    video.removeEventListener("timeupdate", onTimeUpdate);
    video.removeEventListener("seeked", onSeeked);
  };
}

export default function VideoBlockView({
  block,
  containerWidth,
  containerHeight,
  selected,
  mode,
  onSelect,
  onUpdate,
  onDelete,
  onFill,
  fillPending,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Seek to trimStart when the video is ready.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || mode !== "present") return;
    const seek = () => { if (block.trimStart) video.currentTime = block.trimStart; };
    video.addEventListener("loadedmetadata", seek);
    if (video.readyState >= 1) seek();
    return () => video.removeEventListener("loadedmetadata", seek);
  }, [block.trimStart, mode]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mode !== "present") return;
    return enforceTrimAndBreakpoints(video, {
      trimStart: block.trimStart,
      trimEnd: block.trimEnd,
      breakpoints: block.breakpoints,
      loop: block.loop,
    });
  }, [block.breakpoints, block.trimEnd, block.trimStart, block.loop, mode]);

  // x, y, width, height are 0-1 fractions of the container.
  // Convert to pixels for CSS positioning so layout is consistent across
  // any viewport (editor panel width vs fullscreen presentation).
  const px = block.x * containerWidth;
  const py = block.y * containerHeight;
  const pw = block.width * containerWidth;
  const ph = block.height * containerHeight;

  const style: React.CSSProperties = {
    position: "absolute",
    left: px,
    top: py,
    width: pw,
    height: ph,
  };
  const trimBounds = getTrimBounds(block);
  const hasEffectiveTrimEnd = trimBounds.end !== undefined;
  const hasEffectiveBreakpoints = effectiveBreakpoints(block).length > 0;

  if (mode === "present") {
    return (
      <div style={style} className="pointer-events-auto overflow-hidden">
        {block.src ? (
          // Native controls are always hidden during presentation; use J/K/L keyboard shortcuts.
          <video
            ref={videoRef}
            data-block-id={block.id}
            className="w-full h-full"
            style={{ objectFit: block.objectFit }}
            src={block.src}
            autoPlay={block.autoplay}
            loop={block.loop && !hasEffectiveTrimEnd && !hasEffectiveBreakpoints}
            muted={block.muted}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-black/60 text-white/40 text-xs select-none">
            Video missing
          </div>
        )}
      </div>
    );
  }

  const handleDragPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).dataset.resize) return;
    e.preventDefault();
    onSelect?.();
    // Capture block geometry at drag-start so the origin is stable.
    const bx = block.x;
    const by = block.y;
    const bw = block.width;
    const bh = block.height;
    const cw = containerWidth;
    const ch = containerHeight;
    const originX = e.clientX - bx * cw;
    const originY = e.clientY - by * ch;
    const onMove = (ev: PointerEvent) => {
      const rawX = (ev.clientX - originX) / cw;
      const rawY = (ev.clientY - originY) / ch;
      onUpdate?.({
        x: Math.max(0, Math.min(1 - bw, rawX)),
        y: Math.max(0, Math.min(1 - bh, rawY)),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = block.width;
    const startH = block.height;
    const cw = containerWidth;
    const ch = containerHeight;
    const onMove = (ev: PointerEvent) => {
      onUpdate?.({
        width: Math.max(0.05, startW + (ev.clientX - startX) / cw),
        height: Math.max(0.05, startH + (ev.clientY - startY) / ch),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      style={style}
      className={`pointer-events-auto group border-2 rounded overflow-hidden cursor-move select-none ${
        selected ? "border-violet-500" : "border-neutral-500 hover:border-neutral-300"
      }`}
      onPointerDown={handleDragPointerDown}
      onClick={(e) => e.stopPropagation()}
    >
      {block.src ? (
        // Keyed by src so a replaced file remounts with fresh media state.
        <EditorPreview
          key={block.src}
          block={block}
          selected={selected}
          blockWidth={pw}
          blockHeight={ph}
          onUpdate={onUpdate}
        />
      ) : (
        <button
          type="button"
          disabled={fillPending}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onFill?.(); }}
          className="w-full h-full flex items-center justify-center bg-neutral-800 hover:bg-neutral-700 text-neutral-500 hover:text-neutral-300 text-xs select-none transition-colors disabled:pointer-events-none disabled:text-neutral-400"
        >
          {fillPending ? "Adding video…" : onFill ? "Click to add video" : "Video missing"}
        </button>
      )}

      {/* Filename label — replaced by the transport while the video is selected */}
      {!(selected && block.src) && (
        <div className="absolute bottom-0 left-0 right-6 bg-black/60 text-xs text-neutral-300 px-2 py-1 truncate pointer-events-none">
          {block.name}
        </div>
      )}

      {/* Delete button */}
      {selected && onDelete && (
        <button
          title="Delete video"
          className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/70 hover:bg-red-600 text-white text-xs rounded z-10"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this video?")) onDelete(); }}
        >
          ✕
        </button>
      )}

      {/* Resize handle */}
      <div
        data-resize="true"
        title="Drag to resize"
        className="absolute bottom-0 right-0 w-5 h-5 z-20 cursor-se-resize"
        style={{
          background: selected
            ? "linear-gradient(135deg, transparent 50%, #7c3aed 50%)"
            : "linear-gradient(135deg, transparent 50%, #6b7280 50%)",
        }}
        onPointerDown={handleResizePointerDown}
      />
    </div>
  );
}

type MediaState = {
  duration: number | null; // null until metadata is available
  currentTime: number;
  paused: boolean;
  waiting: boolean;
  muted: boolean;
  error: string | null;
};

function EditorPreview({
  block,
  selected,
  blockWidth,
  blockHeight,
  onUpdate,
}: {
  block: VideoBlock;
  selected: boolean;
  blockWidth: number;
  blockHeight: number;
  onUpdate?: (patch: Partial<VideoBlock>) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [media, setMedia] = useState<MediaState>({
    duration: null,
    currentTime: 0,
    paused: true,
    waiting: false,
    muted: block.muted,
    error: null,
  });
  // play() was rejected (autoplay policy etc.); offer a clickable button.
  const [playBlocked, setPlayBlocked] = useState(false);

  // Latest block for mount-scoped listeners (they must not rebind per change).
  const blockRef = useRef(block);
  useEffect(() => { blockRef.current = block; }, [block]);

  // Track real media state from the element, which stays the source of
  // truth; this state only mirrors it for rendering.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const patch = (p: Partial<MediaState>) => setMedia((m) => ({ ...m, ...p }));
    const readDuration = () =>
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;

    const onLoadedMetadata = () => {
      // Start the preview at trim start, like the presentation player.
      const start = blockRef.current.trimStart ?? 0;
      if (start > 0 && video.currentTime < start) video.currentTime = start;
      patch({ duration: readDuration(), currentTime: video.currentTime, error: null });
    };
    const onDurationChange = () => patch({ duration: readDuration() });
    const onTimeUpdate = () => patch({ currentTime: video.currentTime });
    const onSeeked = () => patch({ currentTime: video.currentTime });
    const onPlaying = () => patch({ paused: false, waiting: false });
    const onPause = () => patch({ paused: true });
    const onWaiting = () => patch({ waiting: true });
    const onEnded = () => patch({ paused: true, currentTime: video.currentTime });
    const onVolumeChange = () => patch({ muted: video.muted });
    const onError = () => patch({ error: describeMediaError(video.error) });

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("ended", onEnded);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("error", onError);
    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("error", onError);
    };
  }, []);

  // Preview honors trim and breakpoints exactly like the presentation player.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    return enforceTrimAndBreakpoints(video, {
      trimStart: block.trimStart,
      trimEnd: block.trimEnd,
      breakpoints: block.breakpoints,
      loop: block.loop,
    });
  }, [block.trimStart, block.trimEnd, block.breakpoints, block.loop]);

  // React only applies `muted` on mount; sync metadata changes to the element.
  useEffect(() => {
    const video = videoRef.current;
    if (video && video.muted !== block.muted) video.muted = block.muted;
  }, [block.muted]);

  // Deselecting (or switching slides, which unmounts) pauses the preview.
  useEffect(() => {
    if (!selected) videoRef.current?.pause();
  }, [selected]);

  const attemptPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().then(
      () => setPlayBlocked(false),
      () => setPlayBlocked(true)
    );
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        data-block-id={block.id}
        className="w-full h-full bg-black pointer-events-none"
        style={{ objectFit: block.objectFit }}
        src={block.src}
        preload="metadata"
        muted={block.muted}
        loop={block.loop && getTrimBounds(block).end === undefined && effectiveBreakpoints(block).length === 0}
      />

      {/* Loading state until metadata is available */}
      {!media.error && media.duration === null && (
        <div
          data-testid="video-loading"
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <Loader2 size={18} className="text-white/60 animate-spin" />
        </div>
      )}

      {/* Decode/source errors */}
      {media.error && (
        <div
          data-testid="video-error"
          className="absolute inset-0 flex items-center justify-center bg-black/70 px-3 pointer-events-none"
        >
          <span className="text-xs text-red-300 text-center">{media.error}</span>
        </div>
      )}

      {/* Rejected play() — explicit click always counts as a user gesture */}
      {playBlocked && !media.error && (
        <button
          type="button"
          data-testid="video-play-overlay"
          title="Play"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); attemptPlay(); }}
          className="absolute inset-0 m-auto w-10 h-10 flex items-center justify-center rounded-full bg-black/70 hover:bg-black/90 text-white"
        >
          <Play size={16} />
        </button>
      )}

      {selected && !media.error && (
        <VideoTransport
          block={block}
          media={media}
          videoRef={videoRef}
          blockWidth={blockWidth}
          blockHeight={blockHeight}
          onUpdate={onUpdate}
          attemptPlay={attemptPlay}
        />
      )}
    </>
  );
}

function TransportButton({
  title,
  onClick,
  disabled,
  testId,
  pressed,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="w-6 h-6 flex items-center justify-center rounded text-white/80 hover:text-white hover:bg-white/20 transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0"
    >
      {children}
    </button>
  );
}

function VideoTransport({
  block,
  media,
  videoRef,
  blockWidth,
  blockHeight,
  onUpdate,
  attemptPlay,
}: {
  block: VideoBlock;
  media: MediaState;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  blockWidth: number;
  blockHeight: number;
  onUpdate?: (patch: Partial<VideoBlock>) => void;
  attemptPlay: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the options menu on any outside pointer press.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [menuOpen]);

  const duration = media.duration;
  const ready = duration !== null;
  const bounds = getTrimBounds(block);
  const breakpoints = effectiveBreakpoints(block);

  // Narrow blocks progressively drop controls instead of clipping them; the
  // options popover also needs vertical room above the bar.
  const showTime = blockWidth >= 240;
  const showRestartAndMute = blockWidth >= 170;
  const showMenu = blockWidth >= 120 && blockHeight >= 160;

  const pct = (t: number) => (ready ? `${Math.min(100, Math.max(0, (t / duration) * 100))}%` : "0%");

  const handleScrubPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || duration === null) return;
    e.preventDefault();
    e.stopPropagation();
    const track = e.currentTarget;
    track.setPointerCapture(e.pointerId);
    // Pause during the scrub; resume afterwards only if it was playing.
    const wasPlaying = !video.paused && !video.ended;
    video.pause();
    const seekTo = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      video.currentTime = frac * duration;
    };
    seekTo(e.clientX);
    const onMove = (ev: PointerEvent) => seekTo(ev.clientX);
    const onUp = () => {
      track.removeEventListener("pointermove", onMove);
      track.removeEventListener("pointerup", onUp);
      track.removeEventListener("pointercancel", onUp);
      if (wasPlaying) attemptPlay();
    };
    track.addEventListener("pointermove", onMove);
    track.addEventListener("pointerup", onUp);
    track.addEventListener("pointercancel", onUp);
  };

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      // At the effective end (trim end or media end), play restarts from trim
      // start instead of resuming just to be paused again immediately.
      const resumeAt = playbackResumeTime(video.currentTime, bounds, video.duration, video.ended);
      if (resumeAt !== video.currentTime) video.currentTime = resumeAt;
      attemptPlay();
    } else {
      video.pause();
    }
  };

  // Keyboard seeking for the slider: arrows step 1 s, Home/End jump to the ends.
  const handleScrubKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || duration === null) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let target: number | null = null;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        target = Math.max(0, video.currentTime - 1);
        break;
      case "ArrowRight":
      case "ArrowUp":
        target = Math.min(duration, video.currentTime + 1);
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = duration;
        break;
    }
    if (target !== null) {
      e.preventDefault();
      e.stopPropagation();
      video.currentTime = target;
    }
  };

  const handleRestart = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = bounds.start;
    attemptPlay();
  };

  const handleToggleMute = () => {
    const video = videoRef.current;
    const next = video ? !video.muted : !block.muted;
    if (video) video.muted = next;
    onUpdate?.({ muted: next });
  };

  // Quick timeline actions operate on the live playhead, rounded to 0.1 s to
  // match the precision shown in the time display.
  const playhead = () => {
    const t = videoRef.current?.currentTime ?? media.currentTime;
    return Math.round(t * 10) / 10;
  };

  const nearExistingBreakpoint = (block.breakpoints ?? []).some(
    (bp) => Math.abs(bp - media.currentTime) <= 0.25
  );
  // New breakpoints must land strictly inside the trim range or they would be
  // invisible on the scrubber and never fire.
  const playheadInsideTrim =
    media.currentTime > bounds.start &&
    (bounds.end === undefined || media.currentTime < bounds.end);

  const menuAction = (patch: Partial<VideoBlock>) => {
    onUpdate?.(patch);
    setMenuOpen(false);
  };

  return (
    // pr-6 keeps the controls clear of the corner resize handle, which sits above this bar.
    <div
      data-testid="video-transport"
      className="absolute bottom-0 left-0 right-0 bg-black/75 pl-2 pr-6 pt-1.5 pb-1 flex flex-col gap-1 cursor-default z-10"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Scrubber: trim bounds as shaded regions, breakpoints as ticks */}
      <div
        data-testid="video-scrubber"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={ready ? Math.round(duration * 10) / 10 : 0}
        aria-valuenow={Math.round(media.currentTime * 10) / 10}
        aria-valuetext={`${formatTime(media.currentTime, { tenths: true })} of ${ready ? formatTime(duration) : "unknown"}`}
        tabIndex={ready ? 0 : -1}
        className={`relative h-3 flex items-center rounded outline-none focus-visible:ring-1 focus-visible:ring-white/80 ${ready ? "cursor-pointer" : "opacity-50"}`}
        onPointerDown={handleScrubPointerDown}
        onKeyDown={handleScrubKeyDown}
      >
        <div className="relative w-full h-1 rounded-full bg-white/25">
          {ready && bounds.start > 0 && (
            <div
              data-testid="trim-shade-start"
              className="absolute inset-y-0 left-0 rounded-l-full bg-black/70"
              style={{ width: pct(bounds.start) }}
            />
          )}
          {ready && bounds.end !== undefined && (
            <div
              data-testid="trim-shade-end"
              className="absolute inset-y-0 right-0 rounded-r-full bg-black/70"
              style={{ width: pct(duration - bounds.end) }}
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-indigo-400"
            style={{ width: pct(media.currentTime) }}
          />
          {ready &&
            breakpoints.map((bp) => (
              <div
                key={bp}
                data-testid="breakpoint-tick"
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[3px] h-2.5 rounded-sm bg-amber-400"
                style={{ left: pct(bp) }}
              />
            ))}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white shadow"
            style={{ left: pct(media.currentTime) }}
          />
        </div>
      </div>

      <div className="flex items-center gap-0.5">
        {showRestartAndMute && (
          <TransportButton
            title="Restart from trim start"
            testId="video-restart"
            onClick={handleRestart}
            disabled={!ready}
          >
            <RotateCcw size={12} />
          </TransportButton>
        )}
        <TransportButton
          title={media.paused ? "Play" : "Pause"}
          testId="video-play"
          onClick={handlePlayPause}
          disabled={!ready}
        >
          {media.waiting && !media.paused ? (
            <Loader2 size={12} className="animate-spin" />
          ) : media.paused ? (
            <Play size={12} />
          ) : (
            <Pause size={12} />
          )}
        </TransportButton>
        {showTime && (
          <span
            data-testid="video-time"
            className="text-[10px] text-white/80 tabular-nums px-1 whitespace-nowrap"
          >
            {formatTime(media.currentTime, { tenths: true })} / {ready ? formatTime(duration) : "–:––"}
          </span>
        )}
        <div className="flex-1" />
        {showRestartAndMute && (
          <TransportButton
            title={media.muted ? "Unmute" : "Mute"}
            testId="video-mute"
            pressed={media.muted}
            onClick={handleToggleMute}
          >
            {media.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
          </TransportButton>
        )}
        {showMenu && (
        <div className="relative" ref={menuRef}>
          <TransportButton
            title="Timeline options"
            testId="video-menu"
            pressed={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            disabled={!ready}
          >
            <MoreVertical size={12} />
          </TransportButton>
          {menuOpen && (
            <div
              data-testid="video-menu-popover"
              className="absolute bottom-full right-0 mb-1 w-44 py-1 rounded-lg bg-neutral-900 border border-white/15 shadow-xl z-20"
            >
              <MenuItem
                onClick={() => {
                  const t = playhead();
                  const patch: Partial<VideoBlock> = { trimStart: t > 0 ? t : undefined };
                  // A trim end at/before the new start would be inert, so drop it.
                  if (block.trimEnd !== undefined && block.trimEnd <= t) patch.trimEnd = undefined;
                  menuAction(patch);
                }}
              >
                Set trim start here
              </MenuItem>
              <MenuItem
                disabled={!nearExistingBreakpoint && !playheadInsideTrim}
                onClick={() => menuAction({ breakpoints: toggleBreakpoint(block.breakpoints, playhead()) })}
              >
                {nearExistingBreakpoint ? "Remove breakpoint here" : "Add breakpoint here"}
              </MenuItem>
              <MenuItem
                disabled={media.currentTime <= (block.trimStart ?? 0)}
                onClick={() => menuAction({ trimEnd: playhead() })}
              >
                Set trim end here
              </MenuItem>
              <MenuItem
                disabled={block.trimStart === undefined && block.trimEnd === undefined}
                onClick={() => menuAction({ trimStart: undefined, trimEnd: undefined })}
              >
                Clear trim
              </MenuItem>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="w-full text-left px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}
