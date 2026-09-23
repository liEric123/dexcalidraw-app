import { useEffect, useRef } from "react";
import type { Slide } from "../types/presentation";
import SlideThumbnail from "./SlideThumbnail";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

type Props = {
  slides: Slide[];
  currentSlideId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
};

export default function SlideOverview({ slides, currentSlideId, onSelect, onClose }: Props) {
  const currentRef = useRef<HTMLButtonElement>(null);

  // Capture phase so G closes the overview before Excalidraw sees it.
  // PresentationView's own key handler is inert while the overview is open.
  // Escape and Tab-cycling through the slide buttons are handled by Radix's
  // Dialog (FocusScope traps Tab, DismissableLayer handles Escape), and focus
  // returns to whatever triggered the overview once it closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        data-testid="slide-overview"
        className="inset-0 left-0 top-0 translate-x-0 translate-y-0 w-full h-full max-w-none rounded-none border-0 shadow-none p-0 bg-black/90 overflow-y-auto"
        overlayClassName="bg-transparent"
        onOpenAutoFocus={(e) => { e.preventDefault(); currentRef.current?.focus(); }}
        onClick={onClose}
      >
        <DialogTitle className="sr-only">Slide overview</DialogTitle>
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
      </DialogContent>
    </Dialog>
  );
}
