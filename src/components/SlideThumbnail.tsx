import { useEffect, useState } from "react";
import { exportToSvg } from "@excalidraw/excalidraw";
import type { Slide } from "../types/presentation";

type ExportElements = Parameters<typeof exportToSvg>[0]["elements"];

export default function SlideThumbnail({ slide }: { slide: Slide }) {
  const [svgUrl, setSvgUrl] = useState<string | null>(null);

  const { elements, appState, files } = slide.excalidrawData;
  const hasNotes = slide.notes.trim().length > 0;
  const videoCount = slide.videoBlocks.length;

  useEffect(() => {
    const visible = elements.filter((el) => !el.isDeleted) as ExportElements;
    let cancelled = false;

    // Debounce: defer all state writes so they're never synchronous within the
    // effect body. Empty slides clear immediately (0 ms); non-empty slides wait
    // 300 ms so rapid drawing strokes don't fire exportToSvg on every change.
    const timerId = setTimeout(() => {
      if (cancelled) return;
      if (visible.length === 0) {
        setSvgUrl(null);
        return;
      }
      exportToSvg({
        elements: visible,
        appState: {
          exportBackground: true,
          viewBackgroundColor: appState.viewBackgroundColor ?? "#ffffff",
        },
        files,
        exportPadding: 8,
        skipInliningFonts: true,
      })
        .then((svg: SVGSVGElement) => {
          if (cancelled) return;
          const raw = new XMLSerializer().serializeToString(svg);
          setSvgUrl(`data:image/svg+xml,${encodeURIComponent(raw)}`);
        })
        .catch(() => {});
    }, visible.length === 0 ? 0 : 300);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [elements, appState, files]);

  return (
    <div data-testid="slide-thumbnail" className="relative w-full aspect-video bg-stone-100 overflow-hidden">
      {svgUrl && (
        <img src={svgUrl} alt="" className="w-full h-full object-contain" draggable={false} />
      )}
      {(videoCount > 0 || hasNotes) && (
        <div className="absolute bottom-1 right-1 flex gap-1">
          {videoCount > 0 && (
            <span className="text-[9px] leading-tight bg-black/70 text-neutral-300 px-1 py-0.5 rounded">
              ▶ {videoCount}
            </span>
          )}
          {hasNotes && (
            <span className="text-[9px] leading-tight bg-black/70 text-neutral-300 px-1 py-0.5 rounded">
              ✎
            </span>
          )}
        </div>
      )}
    </div>
  );
}
