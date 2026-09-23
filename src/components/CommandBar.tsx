import { useState, useRef, useEffect } from "react";
import { Command } from "cmdk";
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
  const [error, setError] = useState(false);
  // Command is a controlled component here (both value and onValueChange)
  // specifically so cmdk actually fires onValueChange at all — it's a no-op
  // in uncontrolled mode. That means cmdk's own "auto-select the first item
  // when the list changes" fallback never runs (it only kicks in when this
  // value is falsy), so this must be reset to the new first suggestion by
  // hand on every keystroke, mirroring the old setSelectedIdx(0) behavior.
  const [highlighted, setHighlighted] = useState(
    () => getSuggestions("", state, context)[0]?.text ?? ""
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const suggestions = getSuggestions(input, state, context);

  const tryExecute = (text: string) => {
    const cmd = parseCommand(text, state.inkColor, state.inkStrokeWidth, context);
    if (cmd) {
      setError(false);
      onExecute(cmd);
    } else {
      setError(true);
    }
  };

  // Placed on <Command> itself (not the input): cmdk calls this handler
  // before its own key handling and skips its own case for the key if we
  // call preventDefault, exactly like Radix's DismissableLayer checks
  // event.defaultPrevented before acting on Escape. That lets ArrowUp/
  // ArrowDown/Enter-on-a-highlighted-item fall through to cmdk untouched,
  // while Escape, Tab, and Enter-with-no-suggestions stay fully custom.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (highlighted) setInput(highlighted);
      return;
    }
    if (e.key === "Enter" && suggestions.length === 0) {
      e.preventDefault();
      tryExecute(input);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command bar"
      className="fixed inset-0 z-50"
      onClick={onClose}
      data-testid="command-bar-overlay"
    >
      <Command
        shouldFilter={false}
        label="Command bar"
        value={highlighted}
        onValueChange={setHighlighted}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-20 left-1/2 -translate-x-1/2 w-72"
      >
        {suggestions.length > 0 && (
          <Command.List className="bg-black/85 backdrop-blur-sm rounded-lg mb-1 overflow-hidden border border-white/10">
            {suggestions.map((s) => (
              <Command.Item key={s.text} value={s.text} onSelect={() => tryExecute(s.text)} asChild>
                <button
                  // mousedown + preventDefault keeps focus in the input while firing the action
                  onMouseDown={(e) => e.preventDefault()}
                  className="w-full text-left px-3 py-1.5 text-sm flex items-center justify-between text-white/70 data-[selected=true]:bg-white/15 data-[selected=true]:text-white hover:bg-white/10"
                >
                  <span className="font-mono">{s.text}</span>
                  {s.hint && <span className="text-xs text-white/40">{s.hint}</span>}
                </button>
              </Command.Item>
            ))}
          </Command.List>
        )}

        <div className="flex items-center gap-2 bg-black/85 backdrop-blur-sm border border-white/20 rounded-lg px-3 py-2">
          <span className="text-white/40 text-sm font-mono select-none">/</span>
          <Command.Input
            ref={inputRef}
            value={input}
            onValueChange={(v) => {
              setInput(v);
              setError(false);
              setHighlighted(getSuggestions(v, state, context)[0]?.text ?? "");
            }}
            placeholder="command…"
            className="flex-1 bg-transparent text-white text-sm font-mono outline-none placeholder:text-white/30"
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
      </Command>
    </div>
  );
}
