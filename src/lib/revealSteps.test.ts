import { describe, test, expect } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  addToRevealStep,
  appendRevealStep,
  applyRevealOpacity,
  clearRevealAssignment,
  cloneRevealSteps,
  hiddenElementIds,
  moveRevealStep,
  removeRevealStep,
  resolveRevealSteps,
  revealStepCount,
  stepOfElement,
  validateRevealSteps,
} from "./revealSteps";

function el(
  id: string,
  extra: Partial<ExcalidrawElement> & { containerId?: string | null } = {},
): ExcalidrawElement {
  return { id, type: "rectangle", opacity: 100, isDeleted: false, ...extra } as ExcalidrawElement;
}

const abc = [el("a"), el("b"), el("c")];

describe("resolveRevealSteps", () => {
  test("no steps resolves to an empty list", () => {
    expect(resolveRevealSteps(abc, undefined)).toEqual([]);
    expect(resolveRevealSteps(abc, [])).toEqual([]);
  });

  test("keeps groups in order", () => {
    expect(resolveRevealSteps(abc, [["a"], ["b", "c"]])).toEqual([["a"], ["b", "c"]]);
  });

  test("drops ids whose elements are gone, and groups left empty", () => {
    expect(resolveRevealSteps(abc, [["a", "gone"], ["missing"], ["b"]])).toEqual([["a"], ["b"]]);
  });

  test("treats deleted elements as gone", () => {
    const elements = [el("a"), el("b", { isDeleted: true })];
    expect(resolveRevealSteps(elements, [["a"], ["b"]])).toEqual([["a"]]);
  });

  test("an id in two groups is revealed by the first only", () => {
    expect(resolveRevealSteps(abc, [["a", "b"], ["b", "c"]])).toEqual([["a", "b"], ["c"]]);
  });

  test("does not mutate the input", () => {
    const steps = [["a", "gone"], ["b"]];
    resolveRevealSteps(abc, steps);
    expect(steps).toEqual([["a", "gone"], ["b"]]);
  });
});

describe("revealStepCount", () => {
  test("counts only resolvable groups", () => {
    expect(revealStepCount(abc, [["a"], ["nope"], ["b"]])).toBe(2);
    expect(revealStepCount(abc, undefined)).toBe(0);
  });
});

describe("hiddenElementIds", () => {
  const steps = [["a"], ["b"]];

  test("step 0 hides every assigned element", () => {
    expect([...hiddenElementIds(abc, steps, 0)].sort()).toEqual(["a", "b"]);
  });

  test("each step reveals one more group", () => {
    expect([...hiddenElementIds(abc, steps, 1)]).toEqual(["b"]);
    expect([...hiddenElementIds(abc, steps, 2)]).toEqual([]);
  });

  test("unassigned elements are never hidden", () => {
    expect(hiddenElementIds(abc, steps, 0).has("c")).toBe(false);
  });

  test("out-of-range steps clamp instead of blanking the slide", () => {
    expect([...hiddenElementIds(abc, steps, -5)].sort()).toEqual(["a", "b"]);
    expect([...hiddenElementIds(abc, steps, 99)]).toEqual([]);
  });

  test("a slide with no steps hides nothing", () => {
    expect(hiddenElementIds(abc, undefined, 0).size).toBe(0);
  });

  test("bound text follows its container", () => {
    const elements = [el("box"), el("label", { containerId: "box" }), el("other")];
    const hidden = hiddenElementIds(elements, [["box"]], 0);
    expect(hidden.has("label")).toBe(true);
    expect(hidden.has("other")).toBe(false);
    expect(hiddenElementIds(elements, [["box"]], 1).size).toBe(0);
  });
});

describe("applyRevealOpacity", () => {
  test("zeroes opacity for hidden elements only", () => {
    const out = applyRevealOpacity(abc, new Set(["b"]));
    expect(out.map((e) => e.opacity)).toEqual([100, 0, 100]);
  });

  test("returns the input untouched when nothing is hidden", () => {
    const out = applyRevealOpacity(abc, new Set());
    expect(out).toBe(abc);
  });

  test("does not mutate the source elements", () => {
    applyRevealOpacity(abc, new Set(["a", "b", "c"]));
    expect(abc.map((e) => e.opacity)).toEqual([100, 100, 100]);
  });
});

describe("stepOfElement", () => {
  test("reports a 1-based step, 0 for the base layer", () => {
    const steps = [["a"], ["b"]];
    expect(stepOfElement(steps, "a")).toBe(1);
    expect(stepOfElement(steps, "b")).toBe(2);
    expect(stepOfElement(steps, "c")).toBe(0);
    expect(stepOfElement(undefined, "a")).toBe(0);
  });
});

describe("appendRevealStep", () => {
  test("adds a new final group", () => {
    expect(appendRevealStep([["a"]], ["b"])).toEqual([["a"], ["b"]]);
  });

  test("moves ids out of their previous group", () => {
    expect(appendRevealStep([["a", "b"]], ["b"])).toEqual([["a"], ["b"]]);
  });

  test("drops a group that is emptied by the move", () => {
    expect(appendRevealStep([["a"], ["b"]], ["b"])).toEqual([["a"], ["b"]]);
    expect(appendRevealStep([["b"], ["a"]], ["b"])).toEqual([["a"], ["b"]]);
  });

  test("deduplicates the incoming ids", () => {
    expect(appendRevealStep(undefined, ["a", "a", "b"])).toEqual([["a", "b"]]);
  });

  test("an empty selection is a no-op", () => {
    expect(appendRevealStep([["a"]], [])).toEqual([["a"]]);
  });
});

describe("addToRevealStep", () => {
  test("moves the selection into the target group", () => {
    expect(addToRevealStep([["a"], ["b"]], 0, ["c"])).toEqual([["a", "c"], ["b"]]);
  });

  test("removes the ids from their previous group", () => {
    expect(addToRevealStep([["a"], ["b", "c"]], 0, ["c"])).toEqual([["a", "c"], ["b"]]);
  });

  test("keeps the target even when the source group empties before it", () => {
    // The target index shifts if a preceding group is pruned; the result must
    // still put "a" into the group that was displayed as step 2.
    expect(addToRevealStep([["a"], ["b"]], 1, ["a"])).toEqual([["b", "a"]]);
  });

  test("does not duplicate an id already in the target", () => {
    expect(addToRevealStep([["a", "b"]], 0, ["a"])).toEqual([["a", "b"]]);
  });

  test("out-of-range indices and empty selections are no-ops", () => {
    expect(addToRevealStep([["a"]], 5, ["b"])).toEqual([["a"]]);
    expect(addToRevealStep([["a"]], -1, ["b"])).toEqual([["a"]]);
    expect(addToRevealStep([["a"]], 0, [])).toEqual([["a"]]);
  });
});

describe("removeRevealStep", () => {
  test("removes the group; its ids fall back to the base layer", () => {
    expect(removeRevealStep([["a"], ["b"]], 0)).toEqual([["b"]]);
  });

  test("out-of-range indices are no-ops", () => {
    expect(removeRevealStep([["a"]], 3)).toEqual([["a"]]);
  });
});

describe("clearRevealAssignment", () => {
  test("sends ids back to the base layer", () => {
    expect(clearRevealAssignment([["a", "b"], ["c"]], ["b", "c"])).toEqual([["a"]]);
  });
});

describe("moveRevealStep", () => {
  test("reorders groups", () => {
    expect(moveRevealStep([["a"], ["b"], ["c"]], 2, 0)).toEqual([["c"], ["a"], ["b"]]);
  });

  test("out-of-range and no-op moves leave the order alone", () => {
    expect(moveRevealStep([["a"], ["b"]], 0, 0)).toEqual([["a"], ["b"]]);
    expect(moveRevealStep([["a"], ["b"]], 0, 9)).toEqual([["a"], ["b"]]);
    expect(moveRevealStep([["a"], ["b"]], -1, 0)).toEqual([["a"], ["b"]]);
  });
});

describe("editing helpers never mutate their input", () => {
  test.each([
    ["appendRevealStep", () => appendRevealStep([["a"], ["b"]], ["b"])],
    ["addToRevealStep", () => addToRevealStep([["a"], ["b"]], 0, ["b"])],
    ["removeRevealStep", () => removeRevealStep([["a"], ["b"]], 0)],
    ["moveRevealStep", () => moveRevealStep([["a"], ["b"]], 0, 1)],
    ["clearRevealAssignment", () => clearRevealAssignment([["a"], ["b"]], ["a"])],
  ])("%s", (_name, run) => {
    run();
    // Each call above builds its own literal, so re-running must be stable.
    expect(run()).toEqual(run());
  });
});

describe("validateRevealSteps", () => {
  test("accepts well-formed data", () => {
    expect(validateRevealSteps([["a"], ["b", "c"]])).toEqual([["a"], ["b", "c"]]);
  });

  test("rejects non-arrays", () => {
    expect(validateRevealSteps(undefined)).toBeUndefined();
    expect(validateRevealSteps("nope")).toBeUndefined();
    expect(validateRevealSteps({ 0: ["a"] })).toBeUndefined();
  });

  test("drops non-string ids, empty ids, and non-array groups", () => {
    expect(validateRevealSteps([["a", 3, null, ""], "x", ["b"]])).toEqual([["a"], ["b"]]);
  });

  test("drops duplicate ids across groups", () => {
    expect(validateRevealSteps([["a", "a"], ["a", "b"]])).toEqual([["a"], ["b"]]);
  });

  test("returns undefined rather than an empty array", () => {
    expect(validateRevealSteps([])).toBeUndefined();
    expect(validateRevealSteps([[], []])).toBeUndefined();
  });
});

describe("cloneRevealSteps", () => {
  test("deep copies so copies never share group arrays", () => {
    const original = [["a"], ["b"]];
    const copy = cloneRevealSteps(original)!;
    copy[0].push("z");
    expect(original[0]).toEqual(["a"]);
  });

  test("passes undefined through", () => {
    expect(cloneRevealSteps(undefined)).toBeUndefined();
  });
});
