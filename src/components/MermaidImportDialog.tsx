import { useState, useRef, useEffect } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { convertMermaidToElements } from "../lib/mermaidImport";

export type MermaidInsertTarget = "current" | "new";

type Props = {
  onInsert: (elements: readonly ExcalidrawElement[], target: MermaidInsertTarget) => void;
  onClose: () => void;
};

const PLACEHOLDER = `flowchart TD
  A[Start] --> B{Base case?}
  B -- yes --> C[Return]
  B -- no --> D[Recurse]
  D --> B`;

export default function MermaidImportDialog({ onInsert, onClose }: Props) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState<MermaidInsertTarget>("current");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Conversion is async; a close during it must not land state on an
  // unmounted dialog or insert into a deck the user already dismissed.
  const closedRef = useRef(false);

  useEffect(() => {
    // Reset on mount: StrictMode's throwaway mount runs the cleanup once
    // before the real mount, and the flag must not stay latched.
    closedRef.current = false;
    textareaRef.current?.focus();
    return () => { closedRef.current = true; };
  }, []);

  const handleInsert = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    // convertMermaidToElements returns errors as strings, but keep a
    // defensive boundary here too: an unexpected throw must never leave the
    // dialog stuck on "Converting…".
    let result: Awaited<ReturnType<typeof convertMermaidToElements>>;
    try {
      result = await convertMermaidToElements(source);
    } catch {
      result = "Something went wrong while converting the diagram.";
    } finally {
      if (!closedRef.current) setBusy(false);
    }
    if (closedRef.current) return;
    if (typeof result === "string") {
      setError(result);
      return;
    }
    onInsert(result, target);
  };

  const handleClose = () => {
    if (!busy) onClose();
  };

  // Window-level so Escape works even when focus fell back to <body>
  // (e.g. after the Insert button disabled itself during conversion).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [busy, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleInsert();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleClose}
      onKeyDown={handleKeyDown}
      data-testid="mermaid-dialog-overlay"
    >
      <div
        role="dialog"
        aria-label="Insert Mermaid diagram"
        aria-modal="true"
        className="bg-[#fdf8f4] border border-stone-200 rounded-2xl p-5 w-[520px] max-w-[calc(100vw-2rem)] shadow-xl shadow-stone-200/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest">
            Insert Mermaid diagram
          </span>
          <button
            onClick={handleClose}
            disabled={busy}
            aria-label="Close Mermaid dialog"
            className="w-6 h-6 flex items-center justify-center rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors disabled:opacity-40"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M2 2l6 6M8 2L2 8" />
            </svg>
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={source}
          onChange={(e) => { setSource(e.target.value); setError(null); }}
          placeholder={PLACEHOLDER}
          disabled={busy}
          spellCheck={false}
          rows={10}
          className="w-full resize-y bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm font-mono text-stone-800 outline-none focus:border-stone-400 placeholder:text-stone-300 disabled:opacity-60"
          data-testid="mermaid-source"
        />

        {error && (
          <p
            role="alert"
            className="mt-2 text-xs text-red-600 whitespace-pre-wrap break-words"
            data-testid="mermaid-error"
          >
            {error}
          </p>
        )}

        <div className="flex items-center justify-between mt-3">
          <div
            role="radiogroup"
            aria-label="Insert into"
            className="flex items-center rounded-lg border border-stone-200 bg-stone-100 p-0.5 text-xs"
          >
            {([
              ["current", "Current slide"],
              ["new", "New slide"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                role="radio"
                aria-checked={target === value}
                disabled={busy}
                onClick={() => setTarget(value)}
                className={`px-2.5 py-1 rounded-md transition-colors disabled:opacity-60 ${
                  target === value
                    ? "bg-white text-stone-900 shadow-sm"
                    : "text-stone-500 hover:text-stone-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              disabled={busy}
              className="px-3 py-1.5 text-sm text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleInsert()}
              disabled={busy || source.trim() === ""}
              title="Insert (Ctrl/⌘ + Enter)"
              className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none font-medium shadow-sm shadow-indigo-200"
              data-testid="mermaid-insert"
            >
              {busy ? "Converting…" : "Insert"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
