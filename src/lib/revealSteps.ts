import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * Ordered groups of element ids describing how a slide is built up while
 * presenting. Group `k` becomes visible at step `k + 1`; elements in no group
 * form the base layer and are always visible.
 *
 * A slide with `n` groups has `n + 1` stops: step 0 (base only) through step
 * `n` (everything). Step assignments are stored as ids rather than element
 * flags so drawing data stays exactly what Excalidraw produced.
 */
export type RevealSteps = readonly (readonly string[])[];

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Drop ids that no longer exist on the slide and groups that are empty as a
 * result, and keep only the first assignment of a duplicated id. Stored data
 * is left untouched (deleting an element then undoing restores its step), so
 * this runs on read wherever step numbering has to match what's on the canvas.
 */
export function resolveRevealSteps(
  elements: readonly ExcalidrawElement[],
  revealSteps: RevealSteps | undefined,
): string[][] {
  if (!revealSteps || revealSteps.length === 0) return [];
  const live = new Set(elements.filter((el) => !el.isDeleted).map((el) => el.id));
  const seen = new Set<string>();
  const resolved: string[][] = [];
  for (const group of revealSteps) {
    const ids: string[] = [];
    for (const id of group) {
      if (!live.has(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length > 0) resolved.push(ids);
  }
  return resolved;
}

/** Number of reveal presses a slide needs before it is fully shown. */
export function revealStepCount(
  elements: readonly ExcalidrawElement[],
  revealSteps: RevealSteps | undefined,
): number {
  return resolveRevealSteps(elements, revealSteps).length;
}

/**
 * A container's label is part of the shape, not a separate thing to reveal, so
 * bound text follows whatever its container does.
 */
function withBoundText(
  elements: readonly ExcalidrawElement[],
  ids: ReadonlySet<string>,
): Set<string> {
  const out = new Set(ids);
  for (const el of elements) {
    const containerId = (el as { containerId?: string | null }).containerId;
    if (containerId && out.has(containerId)) out.add(el.id);
  }
  return out;
}

/**
 * Ids hidden at `step`. Groups before `step` are revealed; the rest are not.
 * Out-of-range steps clamp, so a slide whose steps were edited mid-presentation
 * degrades to "fully visible" rather than blanking.
 */
export function hiddenElementIds(
  elements: readonly ExcalidrawElement[],
  revealSteps: RevealSteps | undefined,
  step: number,
): ReadonlySet<string> {
  const resolved = resolveRevealSteps(elements, revealSteps);
  if (resolved.length === 0) return EMPTY_SET;
  const from = Math.min(Math.max(Math.floor(step), 0), resolved.length);
  const hidden = new Set<string>();
  for (let i = from; i < resolved.length; i++) {
    for (const id of resolved[i]) hidden.add(id);
  }
  if (hidden.size === 0) return EMPTY_SET;
  return withBoundText(elements, hidden);
}

/**
 * Hide by zeroing opacity rather than removing elements: bindings, arrows, and
 * container/label relationships stay intact, and the change is confined to the
 * presenter's live scene; it is never written back to the slide.
 */
export function applyRevealOpacity(
  elements: readonly ExcalidrawElement[],
  hidden: ReadonlySet<string>,
): ExcalidrawElement[] {
  if (hidden.size === 0) return elements as ExcalidrawElement[];
  return elements.map((el) =>
    hidden.has(el.id) ? ({ ...el, opacity: 0 } as ExcalidrawElement) : el,
  );
}

/** 1-based step a given element is revealed at, or 0 when it is in the base layer. */
export function stepOfElement(revealSteps: RevealSteps | undefined, id: string): number {
  if (!revealSteps) return 0;
  for (let i = 0; i < revealSteps.length; i++) {
    if (revealSteps[i].includes(id)) return i + 1;
  }
  return 0;
}

function withoutIds(revealSteps: RevealSteps, ids: ReadonlySet<string>): string[][] {
  return revealSteps
    .map((group) => group.filter((id) => !ids.has(id)))
    .filter((group) => group.length > 0);
}

/** Move `ids` out of any existing group and append them as a new final step. */
export function appendRevealStep(
  revealSteps: RevealSteps | undefined,
  ids: readonly string[],
): string[][] {
  const unique = new Set(ids);
  if (unique.size === 0) return (revealSteps ?? []).map((g) => [...g]);
  return [...withoutIds(revealSteps ?? [], unique), [...unique]];
}

/**
 * Move `ids` into the group at `index`. Removing them from their previous group
 * first keeps every element in exactly one step.
 */
export function addToRevealStep(
  revealSteps: RevealSteps | undefined,
  index: number,
  ids: readonly string[],
): string[][] {
  const groups = (revealSteps ?? []).map((g) => [...g]);
  if (index < 0 || index >= groups.length) return groups;
  const unique = new Set(ids);
  if (unique.size === 0) return groups;

  // Track the target by identity: pruning empty groups can shift its index.
  const target = groups[index];
  const kept = groups
    .map((group) => (group === target ? group : group.filter((id) => !unique.has(id))))
    .filter((group) => group === target || group.length > 0);
  for (const id of unique) {
    if (!target.includes(id)) target.push(id);
  }
  return kept;
}

/** Remove a step; its elements return to the always-visible base layer. */
export function removeRevealStep(
  revealSteps: RevealSteps | undefined,
  index: number,
): string[][] {
  const groups = (revealSteps ?? []).map((g) => [...g]);
  if (index < 0 || index >= groups.length) return groups;
  groups.splice(index, 1);
  return groups;
}

/** Send `ids` back to the base layer without disturbing other steps. */
export function clearRevealAssignment(
  revealSteps: RevealSteps | undefined,
  ids: readonly string[],
): string[][] {
  return withoutIds(revealSteps ?? [], new Set(ids));
}

/** Reorder a step. Out-of-range indices are no-ops. */
export function moveRevealStep(
  revealSteps: RevealSteps | undefined,
  from: number,
  to: number,
): string[][] {
  const groups = (revealSteps ?? []).map((g) => [...g]);
  if (from < 0 || from >= groups.length || to < 0 || to >= groups.length || from === to) {
    return groups;
  }
  const [moved] = groups.splice(from, 1);
  groups.splice(to, 0, moved);
  return groups;
}

/**
 * Validate persisted/imported reveal data. Returns `undefined` for anything
 * that is not a non-empty array of id groups so a malformed field can never
 * blank out a slide in presentation mode.
 */
export function validateRevealSteps(raw: unknown): string[][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const groups: string[][] = [];
  const seen = new Set<string>();
  for (const group of raw) {
    if (!Array.isArray(group)) continue;
    const ids: string[] = [];
    for (const id of group) {
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length > 0) groups.push(ids);
  }
  return groups.length > 0 ? groups : undefined;
}

/** Deep copy for slide duplication and template instantiation. */
export function cloneRevealSteps(revealSteps: RevealSteps | undefined): string[][] | undefined {
  return revealSteps ? revealSteps.map((group) => [...group]) : undefined;
}
