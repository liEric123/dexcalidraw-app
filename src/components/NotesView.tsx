import { useEffect, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import { loadMostRecentPresentation, loadPresentationById } from "../lib/storage";
import type { Presentation } from "../types/presentation";

function loadNotesPresentation(): Presentation | null {
  const id = new URLSearchParams(window.location.search).get("id");
  return id ? loadPresentationById(id) : loadMostRecentPresentation();
}

export default function NotesView() {
  const [presentation, setPresentation] = useState<Presentation | null>(() => loadNotesPresentation());

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith("excalidraw-video-deck")) {
        setPresentation(loadNotesPresentation());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  if (!presentation) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-500 flex items-center justify-center text-sm">
        No presentation loaded.
      </div>
    );
  }

  const currentIndex = presentation.slides.findIndex((s) => s.id === presentation.currentSlideId);
  const current = presentation.slides[currentIndex];
  const next = presentation.slides[currentIndex + 1];
  const hasSlides = presentation.slides.length > 0;
  const hasNotesDrawing = current?.notesDrawing?.elements?.some((el) => !el.isDeleted) ?? false;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col p-5 gap-4">
      <div className="flex items-baseline gap-3 pb-3 border-b border-neutral-800 shrink-0">
        <span className="text-xs text-neutral-500 tabular-nums shrink-0">
          {hasSlides ? `${currentIndex + 1} / ${presentation.slides.length}` : "0 / 0"}
        </span>
        <span className="text-sm font-medium text-neutral-300">{current?.title ?? "No slides"}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
        <div className="text-lg leading-relaxed whitespace-pre-wrap">
          {!hasSlides
            ? <span className="text-neutral-600 italic text-base">No slides in this presentation.</span>
            : current?.notes
            ? current.notes
            : !hasNotesDrawing
            ? <span className="text-neutral-600 italic text-base">No notes for this slide.</span>
            : null
          }
        </div>
        {hasSlides && hasNotesDrawing && (
          <div className="shrink-0 h-64 rounded-lg overflow-hidden border border-neutral-800">
            <Excalidraw
              key={current!.id}
              viewModeEnabled
              theme="dark"
              initialData={{
                elements: current!.notesDrawing!.elements,
                appState: { viewBackgroundColor: "#111113" },
                files: current!.notesDrawing!.files ?? {},
                scrollToContent: true,
              }}
            />
          </div>
        )}
      </div>

      {next && (
        <div className="shrink-0 pt-3 border-t border-neutral-800 text-xs text-neutral-500">
          Next → {next.title}
        </div>
      )}
    </div>
  );
}
