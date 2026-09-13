import type { Slide } from "../types/presentation";
import {
  addToRevealStep,
  appendRevealStep,
  clearRevealAssignment,
  moveRevealStep,
  removeRevealStep,
  resolveRevealSteps,
} from "../lib/revealSteps";

type Props = {
  slide: Slide;
  selectedElementIds: string[];
  onChange: (steps: string[][]) => void;
  onSelectElements: (ids: string[]) => void;
};

function IconButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-stone-700 hover:bg-stone-200 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-stone-400 transition-colors text-xs leading-none"
    >
      {children}
    </button>
  );
}

export default function RevealStepsPanel({
  slide,
  selectedElementIds,
  onChange,
  onSelectElements,
}: Props) {
  const elements = slide.excalidrawData.elements;
  // Resolved rather than raw: ids whose elements were deleted must not be
  // counted, or the panel disagrees with what presenting actually does.
  const steps = resolveRevealSteps(elements, slide.revealSteps);
  const assigned = new Set(steps.flat());
  const baseCount = elements.filter((el) => !el.isDeleted && !assigned.has(el.id)).length;
  const hasSelection = selectedElementIds.length > 0;
  const selectionIsAssigned = selectedElementIds.some((id) => assigned.has(id));

  const label = (n: number) => `${n} ${n === 1 ? "shape" : "shapes"}`;

  return (
    <div className="shrink-0 border-t border-stone-200 max-h-[45%] flex flex-col">
      <div className="px-3 py-2 flex items-center gap-2 shrink-0">
        <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest">
          Reveal
        </span>
        {steps.length > 0 && (
          <span className="text-[10px] text-stone-400 tabular-nums">
            {steps.length} {steps.length === 1 ? "step" : "steps"}
          </span>
        )}
      </div>

      <div className="px-3 pb-3 flex flex-col gap-1.5 overflow-y-auto">
        <button
          onClick={() => onChange(appendRevealStep(steps, selectedElementIds))}
          disabled={!hasSelection}
          data-testid="reveal-add-step"
          className="w-full text-xs px-2 py-1.5 rounded bg-stone-200/70 hover:bg-stone-300/70 text-stone-700 disabled:opacity-40 disabled:hover:bg-stone-200/70 transition-colors"
        >
          {hasSelection
            ? `Add step from selection (${label(selectedElementIds.length)})`
            : "Select shapes to add a step"}
        </button>

        <div
          className="flex items-center gap-2 px-2 py-1 rounded text-xs text-stone-500"
          title="Shapes that are visible from the start"
        >
          <span className="w-4 text-center text-stone-400">·</span>
          <span className="flex-1 truncate">Base — always visible</span>
          <span className="tabular-nums text-stone-400">{label(baseCount)}</span>
        </div>

        {steps.map((ids, i) => (
          <div
            key={i}
            data-testid="reveal-step-row"
            className="group flex items-center gap-2 px-2 py-1 rounded text-xs text-stone-600 hover:bg-stone-100"
          >
            <button
              onClick={() => onSelectElements(ids)}
              title="Select this step's shapes on the canvas"
              className="flex-1 flex items-center gap-2 text-left min-w-0"
            >
              <span className="w-4 text-center tabular-nums font-medium text-stone-500">
                {i + 1}
              </span>
              <span className="flex-1 truncate tabular-nums text-stone-400">{label(ids.length)}</span>
            </button>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <IconButton
                onClick={() => onChange(addToRevealStep(steps, i, selectedElementIds))}
                disabled={!hasSelection}
                title="Move selection into this step"
              >
                +
              </IconButton>
              <IconButton
                onClick={() => onChange(moveRevealStep(steps, i, i - 1))}
                disabled={i === 0}
                title="Move step earlier"
              >
                ↑
              </IconButton>
              <IconButton
                onClick={() => onChange(moveRevealStep(steps, i, i + 1))}
                disabled={i === steps.length - 1}
                title="Move step later"
              >
                ↓
              </IconButton>
              <IconButton
                onClick={() => onChange(removeRevealStep(steps, i))}
                title="Delete step (shapes stay on the slide)"
              >
                ✕
              </IconButton>
            </div>
          </div>
        ))}

        {selectionIsAssigned && (
          <button
            onClick={() => onChange(clearRevealAssignment(steps, selectedElementIds))}
            className="w-full text-xs px-2 py-1 rounded text-stone-500 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            Send selection back to base
          </button>
        )}

        {steps.length === 0 && (
          <p className="text-[11px] text-stone-400 leading-relaxed px-0.5 pt-0.5">
            Steps reveal shapes one at a time while presenting. Everything else stays
            visible from the start.
          </p>
        )}
      </div>
    </div>
  );
}
