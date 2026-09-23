export const COLOR_NAMES: Record<string, string> = {
  red: "#e11d48",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  white: "#ffffff",
};

export const VALID_WIDTHS = [1, 2, 4] as const;

export type ParsedCommand =
  | { type: "pen"; color: string; width: number }
  | { type: "highlight"; color: string; width: number }
  | { type: "laser" }
  | { type: "goto"; slide?: number }
  | { type: "clear" }
  | { type: "undo" }
  | { type: "off" }
  | { type: "mermaid" }
  | { type: "reveal" };

// Which command set the bar exposes: presenter commands or editor commands.
export type CommandContext = "present" | "editor";

/** Parse optional [color] [width] args shared by pen and highlight; null on invalid input. */
function parseColorWidthArgs(
  args: string[],
  currentColor: string,
  currentWidth: number,
): { color: string; width: number } | null {
  let color = currentColor;
  let width = currentWidth;
  let colorSet = false;
  let widthSet = false;
  for (const arg of args) {
    if (COLOR_NAMES[arg] !== undefined) {
      if (colorSet) return null; // reject "pen red blue"
      color = COLOR_NAMES[arg];
      colorSet = true;
    } else if ((VALID_WIDTHS as readonly number[]).includes(Number(arg))) {
      if (widthSet) return null; // reject "pen 1 2"
      width = Number(arg);
      widthSet = true;
    } else {
      return null;
    }
  }
  return { color, width };
}

/** Parse a command string (without leading /) into a typed action, or null for unrecognized input. */
export function parseCommand(
  raw: string,
  currentColor: string,
  currentWidth: number,
  context: CommandContext = "present",
): ParsedCommand | null {
  const parts = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const [cmd, ...args] = parts;

  if (context === "editor") {
    if (args.length > 0) return null;
    if (cmd === "mermaid") return { type: "mermaid" };
    if (cmd === "reveal") return { type: "reveal" };
    return null;
  }

  switch (cmd) {
    case "pen": {
      const parsed = parseColorWidthArgs(args, currentColor, currentWidth);
      return parsed ? { type: "pen", ...parsed } : null;
    }
    case "highlight": {
      const parsed = parseColorWidthArgs(args, currentColor, currentWidth);
      return parsed ? { type: "highlight", ...parsed } : null;
    }
    case "laser":
      return args.length === 0 ? { type: "laser" } : null;
    case "goto": {
      // Bare "goto" opens the slide overview; "goto [n]" jumps to a 1-based slide number.
      if (args.length === 0) return { type: "goto" };
      if (args.length === 1 && /^\d+$/.test(args[0]) && Number(args[0]) >= 1) {
        return { type: "goto", slide: Number(args[0]) };
      }
      return null;
    }
    case "clear":
      return args.length === 0 ? { type: "clear" } : null;
    case "undo":
      return args.length === 0 ? { type: "undo" } : null;
    case "off":
      return args.length === 0 ? { type: "off" } : null;
    default:
      return null;
  }
}

export type Suggestion = {
  text: string;
  hint?: string;
};

export type CommandActiveState = {
  inkMode: boolean;
  inkHighlight: boolean;
  laserMode: boolean;
  inkColor: string;
  inkStrokeWidth: number;
};

function buildAllCompletions(): readonly string[] {
  const colors = Object.keys(COLOR_NAMES);
  const widths = VALID_WIDTHS.map(String);
  const result: string[] = [];
  // Colors and widths first so they rank before color+width combos in the cap.
  for (const cmd of ["pen", "highlight"]) {
    result.push(cmd);
    for (const c of colors) result.push(`${cmd} ${c}`);
    for (const w of widths) result.push(`${cmd} ${w}`);
    for (const c of colors) for (const w of widths) result.push(`${cmd} ${c} ${w}`);
  }
  result.push("laser", "goto", "clear", "undo", "off");
  return result;
}

const ALL_COMPLETIONS = buildAllCompletions();

function colorNameFor(hex: string): string | undefined {
  return Object.entries(COLOR_NAMES).find(([, v]) => v === hex)?.[0];
}

const EDITOR_SUGGESTIONS: readonly Suggestion[] = [
  { text: "mermaid", hint: "(insert diagram)" },
  { text: "reveal", hint: "(new step from selection)" },
];

/** Return autocomplete suggestions for the current input string and presenter state. */
export function getSuggestions(
  input: string,
  state: CommandActiveState,
  context: CommandContext = "present",
): Suggestion[] {
  // trimStart preserves a trailing space so "pen " matches "pen red" but not "pen" itself.
  // Replace runs of 2+ spaces so "pen  red" normalizes to "pen red".
  const normalized = input.trimStart().toLowerCase().replace(/\s{2,}/g, " ");

  if (context === "editor") {
    return EDITOR_SUGGESTIONS.filter((s) => normalized === "" || s.text.startsWith(normalized));
  }
  const colorName = colorNameFor(state.inkColor);
  const penActive = state.inkMode && !state.inkHighlight;
  const highlightActive = state.inkMode && state.inkHighlight;
  const inkHint = `(${colorName ?? state.inkColor} ${state.inkStrokeWidth})`;

  if (normalized === "") {
    return [
      { text: "pen", hint: penActive ? inkHint : undefined },
      { text: "highlight", hint: highlightActive ? inkHint : undefined },
      { text: "laser", hint: state.laserMode ? "(active)" : undefined },
      { text: "goto", hint: "(overview, or goto [n])" },
      { text: "clear" },
      { text: "undo" },
      { text: "off" },
    ];
  }

  return ALL_COMPLETIONS.filter((c) => c.startsWith(normalized))
    .slice(0, 9)
    .map((text) => {
      let hint: string | undefined;
      if (text === "pen" && penActive) {
        hint = inkHint;
      } else if (text === "highlight" && highlightActive) {
        hint = inkHint;
      } else if (text === "laser" && state.laserMode) {
        hint = "(active)";
      } else if (text === "goto") {
        hint = "(overview, or goto [n])";
      } else if (
        colorName &&
        ((text === `pen ${colorName}` && penActive) ||
          (text === `pen ${colorName} ${state.inkStrokeWidth}` && penActive) ||
          (text === `highlight ${colorName}` && highlightActive) ||
          (text === `highlight ${colorName} ${state.inkStrokeWidth}` && highlightActive))
      ) {
        hint = "(current)";
      }
      return { text, hint };
    });
}
