import { useState, useRef, useEffect } from "react";
import { getSuggestions, parseCommand } from "../lib/commandParser";
import type { ParsedCommand, CommandActiveState, CommandContext } from "../lib/commandParser";

// The editor context has no presenter ink state; these defaults keep the
// shared parser signature satisfied without affecting editor commands.
const DEFAULT_ACTIVE_STATE: CommandActiveState = {
  inkMode: false,
  inkHighlight: false,
  laserMode: false,
  inkColor: "#e11d48",
  inkStrokeWidth: 2,
};

type Props = Partial<CommandActiveState> & {
  context?: CommandContext;
  onExecute: (cmd: ParsedCommand) => void;
  onClose: () => void;
};

export default function CommandBar({ context = "present", onExecute, onClose, ...activeState }: Props) {
  const state: CommandActiveState = { ...DEFAULT_ACTIVE_STATE, ...activeState };
  const [input, setInput] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const suggestions = getSuggestions(input, state, context);
  // Keep selection in range if suggestions shrink; reset is done in onChange.
  const safeIdx = Math.min(selectedIdx, Math.max(0, suggestions.length - 1));

  const tryExecute = (text: string) => {
    const cmd = parseCommand(text, state.inkColor, state.inkStrokeWidth, context);
    if (cmd) {
      setError(false);
      onExecute(cmd);
    } else {
      setError(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "Escape":
        e.stopPropagation();
        onClose();
        break;
      case "Enter": {
        e.preventDefault();
        tryExecute(suggestions[safeIdx]?.text ?? input);
        break;
      }
      case "ArrowDown":
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        break;
      case "Tab": {
        e.preventDefault();
        const s = suggestions[safeIdx];
        if (s) setInput(s.text);
        break;
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      data-testid="command-bar-overlay"
    >
      <div
        role="dialog"
        aria-label="Command bar"
        aria-modal="true"
        className="absolute bottom-20 left-1/2 -translate-x-1/2 w-72"
        onClick={(e) => e.stopPropagation()}
      >
        {suggestions.length > 0 && (
          <div className="bg-black/85 backdrop-blur-sm rounded-lg mb-1 overflow-hidden border border-white/10">
            {suggestions.map((s, i) => (
              <button
                key={s.text}
                // mousedown + preventDefault keeps focus in the input while firing the action
                onMouseDown={(e) => { e.preventDefault(); tryExecute(s.text); }}
                onMouseEnter={() => setSelectedIdx(i)}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between ${
                  i === safeIdx
                    ? "bg-white/15 text-white"
                    : "text-white/70 hover:bg-white/10"
                }`}
              >
                <span className="font-mono">{s.text}</span>
                {s.hint && <span className="text-xs text-white/40">{s.hint}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 bg-black/85 backdrop-blur-sm border border-white/20 rounded-lg px-3 py-2">
          <span className="text-white/40 text-sm font-mono select-none">/</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setSelectedIdx(0); setError(false); }}
            onKeyDown={handleKeyDown}
            placeholder="command…"
            className="flex-1 bg-transparent text-white text-sm font-mono outline-none placeholder:text-white/30"
            spellCheck={false}
            autoComplete="off"
            data-testid="command-bar-input"
          />
          {error && (
            <span
              role="alert"
              aria-live="polite"
              className="text-xs text-rose-400/80 whitespace-nowrap"
              data-testid="command-bar-error"
            >
              Unknown command
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
