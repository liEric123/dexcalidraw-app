import { useEffect, useRef } from "react";
import type { Slide } from "../types/presentation";
import SlideThumbnail from "./SlideThumbnail";

type Props = {
  slides: Slide[];
  currentSlideId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
};

export default function SlideOverview({ slides, currentSlideId, onSelect, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);

  // Focus the current slide so Tab/Enter keyboard navigation starts from it,
  // and restore whatever had focus once the overview closes.
  useEffect(() => {
    const previous = document.activeElement;
    currentRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  // Capture phase so Escape/G close the overview before Excalidraw sees them.
  // PresentationView's own key handler is inert while the overview is open.
  // Tab is trapped inside the dialog: focus cycles through the slide buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const buttons = [...(containerRef.current?.querySelectorAll("button") ?? [])];
        if (buttons.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.shiftKey
          ? buttons[(idx <= 0 ? buttons.length : idx) - 1]
          : buttons[(idx + 1) % buttons.length];
        next.focus();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape" || e.key === "g" || e.key === "G") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Slide overview"
      data-testid="slide-overview"
      className="absolute inset-0 z-40 bg-black/90 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="max-w-5xl mx-auto p-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {slides.map((slide, i) => (
          <button
            key={slide.id}
            ref={slide.id === currentSlideId ? currentRef : undefined}
            onClick={() => onSelect(slide.id)}
            data-testid="overview-slide"
            className={`text-left rounded-lg overflow-hidden ring-2 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-white ${
              slide.id === currentSlideId ? "ring-rose-500" : "ring-white/15 hover:ring-white/40"
            }`}
          >
            <SlideThumbnail slide={slide} />
            <div className="px-2 py-1.5 bg-white/10 text-xs text-white/80 flex items-center gap-2">
              <span className="text-white/40 tabular-nums">{i + 1}</span>
              <span className="truncate">{slide.title}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
