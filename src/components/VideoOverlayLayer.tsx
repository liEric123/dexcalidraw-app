import { useRef, useState, useLayoutEffect } from "react";
import type { VideoBlock } from "../types/presentation";
import VideoBlockView from "./VideoBlockView";

type Props = {
  blocks: VideoBlock[];
  selectedVideoId: string | null;
  mode: "editor" | "present";
  onSelectVideo: (id: string) => void;
  onUpdateVideo: (id: string, patch: Partial<VideoBlock>) => void;
  onDeleteVideo: (id: string) => void;
  onFillVideo?: (id: string) => void;
  fillPending?: boolean;
};

export default function VideoOverlayLayer({
  blocks,
  selectedVideoId,
  mode,
  onSelectVideo,
  onUpdateVideo,
  onDeleteVideo,
  onFillVideo,
  fillPending,
}: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Measure the overlay div so VideoBlockView can convert normalized 0-1
  // coordinates to screen pixels consistently across editor and presenter.
  useLayoutEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setContainerSize({ width, height });
    const ro = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={divRef} className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {containerSize.width > 0 && blocks.map((block) => (
        <VideoBlockView
          key={block.id}
          block={block}
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
          selected={block.id === selectedVideoId}
          mode={mode}
          onSelect={() => onSelectVideo(block.id)}
          onUpdate={(patch) => onUpdateVideo(block.id, patch)}
          onDelete={() => onDeleteVideo(block.id)}
          onFill={onFillVideo ? () => onFillVideo(block.id) : undefined}
          fillPending={fillPending}
        />
      ))}
    </div>
  );
}
