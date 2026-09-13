import { useEffect } from "react";

type Props = { onClose: () => void };

export default function HelpOverlay({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#fdf8f4] border border-stone-200 rounded-2xl p-5 w-72 shadow-xl shadow-stone-200/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest">Shortcuts</span>
          <button
            onClick={onClose}
            aria-label="Close help"
            className="w-6 h-6 flex items-center justify-center rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M2 2l6 6M8 2L2 8" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <section>
            <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest mb-2">Editor</p>
            <ul className="space-y-1.5 text-xs text-stone-500">
              <li>Draw diagrams directly on the canvas</li>
              <li><span className="text-stone-600">Add Video</span> → drag to reposition, corner to resize</li>
              <li>Click a clip to select and configure it</li>
              <li><kbd className="text-stone-700 font-mono bg-stone-100 px-1 py-0.5 rounded text-[10px]">/</kbd> Command bar → <span className="font-mono">mermaid</span> inserts an editable diagram</li>
              <li><kbd className="text-stone-700 font-mono bg-stone-100 px-1 py-0.5 rounded text-[10px]">/</kbd> Command bar → <span className="font-mono">reveal</span> makes the selection a reveal step</li>
              <li>Select shapes, then use the <span className="text-stone-600">Reveal</span> panel to build a slide up step by step</li>
            </ul>
          </section>

          <div className="h-px bg-stone-100" />

          <section>
            <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest mb-2">Presentation</p>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              {([
                ["→ / Space", "Next reveal step, then next slide"],
                ["←", "Previous reveal step, then previous slide"],
                ["R", "Restart videos"],
                ["V", "Resume breakpoint video"],
                ["J", "Rewind 5s"],
                ["K", "Play / pause"],
                ["L", "Forward 5s"],
                ["/", "Command bar"],
                ["G", "Slide overview"],
                ["P", "Toggle pen"],
                ["H", "Toggle highlighter"],
                ["Z", "Laser pointer"],
                ["C", "Clear ink"],
                ["Ctrl / ⌘ Z", "Undo ink stroke"],
                ["N", "Open notes window"],
                ["Esc", "Exit / stop drawing"],
              ] as const).map(([key, label]) => (
                <div key={key} className="contents">
                  <kbd className="text-stone-700 font-mono bg-stone-100 px-1 py-0.5 rounded text-[10px] self-start">{key}</kbd>
                  <span className="text-stone-500">{label}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
