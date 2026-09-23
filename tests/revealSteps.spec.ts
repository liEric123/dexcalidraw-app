import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// The presentation frame is 1600x900 at the origin and is fitted to the
// viewport, so a shape covering the middle of the frame covers the middle of
// the screen. Each shape is a solid, roughness-free fill in its own colour so a
// single centre-pixel sample says exactly which one is on screen.
const RED = { r: 220, g: 38, b: 38 };
const BLUE = { r: 37, g: 99, b: 235 };

function rect(id: string, color: string, x: number, y: number, width: number, height: number) {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: color,
    backgroundColor: color,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
}

// Full-frame overlapping shapes: whichever is revealed last wins the centre.
const BASE_RECT = rect("base-rect", "#111111", 0, 0, 1600, 900);
const STEP_ONE_RECT = rect("step-one", "#dc2626", 200, 100, 1200, 700);
const STEP_TWO_RECT = rect("step-two", "#2563eb", 300, 150, 1000, 600);

type SeedSlide = {
  id: string;
  title: string;
  elements: unknown[];
  revealSteps?: string[][];
};

async function seedDeck(page: Page, slides: SeedSlide[]) {
  await page.evaluate((seeded) => {
    localStorage.clear();
    const deck = {
      id: "deck-reveal",
      title: "Reveal deck",
      slides: seeded.map((s) => ({
        id: s.id,
        title: s.title,
        excalidrawData: {
          elements: s.elements,
          appState: { viewBackgroundColor: "#ffffff" },
          files: {},
        },
        videoBlocks: [],
        notes: "",
        ...(s.revealSteps ? { revealSteps: s.revealSteps } : {}),
      })),
      currentSlideId: seeded[0].id,
      createdAt: 1,
      updatedAt: 2,
    };
    localStorage.setItem("excalidraw-video-deck:p:deck-reveal", JSON.stringify(deck));
  }, slides);
  await page.reload();
  await page.getByTestId("presentation-card").filter({ hasText: "Reveal deck" }).click();
  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeVisible();
}

async function readDeck(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("excalidraw-video-deck:p:deck-reveal") ?? "null"),
  );
}

/**
 * Colour at the centre of the viewport, read from whichever Excalidraw canvas
 * actually painted there. Hidden elements are drawn at opacity 0, so they
 * simply do not contribute.
 */
async function pixelAt(
  page: Page,
  point?: { x: number; y: number },
): Promise<{ r: number; g: number; b: number }> {
  return page.evaluate((p) => {
    const px = p ? p.x : window.innerWidth / 2;
    const py = p ? p.y : window.innerHeight / 2;
    const canvases = [...document.querySelectorAll("canvas")];
    let best = { r: 255, g: 255, b: 255 };
    for (const canvas of canvases) {
      const box = canvas.getBoundingClientRect();
      if (box.width < 100 || box.height < 100) continue;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) continue;
      const x = Math.round((px - box.left) * (canvas.width / box.width));
      const y = Math.round((py - box.top) * (canvas.height / box.height));
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
      if (a > 0) best = { r, g, b };
    }
    return best;
  }, point);
}

const centrePixel = (page: Page) => pixelAt(page);

function near(
  actual: { r: number; g: number; b: number },
  expected: { r: number; g: number; b: number },
) {
  return (
    Math.abs(actual.r - expected.r) < 40 &&
    Math.abs(actual.g - expected.g) < 40 &&
    Math.abs(actual.b - expected.b) < 40
  );
}

async function expectCentre(page: Page, expected: { r: number; g: number; b: number }) {
  await expect
    .poll(async () => near(await centrePixel(page), expected), { timeout: 8000 })
    .toBe(true);
}

async function expectCentreNot(page: Page, unexpected: { r: number; g: number; b: number }) {
  await expect
    .poll(async () => near(await centrePixel(page), unexpected), { timeout: 8000 })
    .toBe(false);
}

// Mark the demo deck as already seeded, on every navigation this page makes
// (addInitScript re-runs before each one, including seedDeck's reload below),
// so tests never see the auto-created sample deck real first-time visitors
// get (see seedDemoPresentationIfFirstRun in src/lib/storage.ts).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("excalidraw-video-deck:demo-seeded", "1"));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dexcalidraw" })).toBeVisible();
});

test("stepping forward reveals one group at a time, and the counter tracks it", async ({ page }) => {
  await seedDeck(page, [
    {
      id: "s1",
      title: "Build",
      elements: [BASE_RECT, STEP_ONE_RECT, STEP_TWO_RECT],
      revealSteps: [["step-one"], ["step-two"]],
    },
  ]);

  await page.getByRole("button", { name: "Present", exact: true }).click();
  const counter = page.getByTestId("presentation-counter");
  await expect(counter).toContainText("0 / 2");

  // Step 0: only the base layer is painted.
  await expectCentreNot(page, RED);
  await expectCentreNot(page, BLUE);

  await page.keyboard.press("ArrowRight");
  await expect(counter).toContainText("1 / 2");
  await expectCentre(page, RED);

  await page.keyboard.press("ArrowRight");
  await expect(counter).toContainText("2 / 2");
  await expectCentre(page, BLUE);

  // Backwards walks the same path.
  await page.keyboard.press("ArrowLeft");
  await expect(counter).toContainText("1 / 2");
  await expectCentre(page, RED);
});

test("slides without reveal steps behave exactly as before", async ({ page }) => {
  await seedDeck(page, [
    { id: "s1", title: "One", elements: [BASE_RECT, STEP_ONE_RECT] },
    { id: "s2", title: "Two", elements: [BASE_RECT] },
  ]);

  await page.getByRole("button", { name: "Present", exact: true }).click();
  const counter = page.getByTestId("presentation-counter");

  // No step segment is shown at all, and everything is visible immediately.
  await expect(counter).toHaveText("1 / 2");
  await expectCentre(page, RED);

  await page.keyboard.press("ArrowRight");
  await expect(counter).toHaveText("2 / 2");
});

test("the last step advances to the next slide, and stepping back returns to it fully revealed", async ({ page }) => {
  await seedDeck(page, [
    {
      id: "s1",
      title: "One",
      elements: [BASE_RECT, STEP_ONE_RECT],
      revealSteps: [["step-one"]],
    },
    { id: "s2", title: "Two", elements: [BASE_RECT] },
  ]);

  await page.getByRole("button", { name: "Present", exact: true }).click();
  const counter = page.getByTestId("presentation-counter");
  await expect(counter).toContainText("1 / 2");
  await expect(counter).toContainText("0 / 1");

  await page.keyboard.press("ArrowRight"); // reveal step 1
  await expect(counter).toContainText("1 / 1");
  await expectCentre(page, RED);

  await page.keyboard.press("ArrowRight"); // now advance the slide
  await expect(counter).toHaveText("2 / 2");
  await expectCentreNot(page, RED);

  // Back into the previous slide lands on its final step, not its start.
  await page.keyboard.press("ArrowLeft");
  await expect(counter).toContainText("1 / 2");
  await expect(counter).toContainText("1 / 1");
  await expectCentre(page, RED);
});

test("presenter ink survives stepping and is not cleared by a reveal", async ({ page }) => {
  await seedDeck(page, [
    {
      id: "s1",
      title: "Build",
      elements: [BASE_RECT, STEP_ONE_RECT],
      revealSteps: [["step-one"]],
    },
  ]);

  await page.getByRole("button", { name: "Present", exact: true }).click();
  const view = page.getByTestId("presentation-view");

  await page.keyboard.press("p");
  // setActiveTool commits asynchronously inside Excalidraw, so wait for the
  // real freedraw signal before drawing, or the stroke becomes a selection drag.
  await expect(view).toHaveAttribute("data-canvas-ink-state", "freedraw:2:100");
  await page.mouse.move(350, 250);
  await page.mouse.down();
  await page.mouse.move(450, 350);
  await page.mouse.up();
  await expect(view).toHaveAttribute("data-ink-count", /^[1-9]/);

  // Advancing a step patches the live scene; it must not remount the canvas
  // and drop the stroke the presenter just drew.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("presentation-counter")).toContainText("1 / 1");
  await expectCentre(page, RED);
  await expect(view).toHaveAttribute("data-ink-count", /^[1-9]/);
});

test("adding a step from the canvas selection persists and drives presenting", async ({ page }) => {
  await seedDeck(page, [
    { id: "s1", title: "Build", elements: [BASE_RECT, STEP_ONE_RECT] },
  ]);

  await expect(page.getByTestId("reveal-add-step")).toBeDisabled();

  // Both rects are centred on the frame, so the canvas centre always sits on
  // the topmost (red) one, but only once Excalidraw has finished fitting the
  // scene. Wait for red to actually be painted there before clicking, or the
  // click can hit-test the base rect instead and select the wrong shape.
  const box = (await page.locator("canvas").first().boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await expect
    .poll(async () => near(await pixelAt(page, centre), RED), { timeout: 8000 })
    .toBe(true);

  await page.mouse.click(centre.x, centre.y);
  await expect(page.getByTestId("reveal-add-step")).toBeEnabled();
  await page.getByTestId("reveal-add-step").click();

  await expect(page.getByTestId("reveal-step-row")).toHaveCount(1);
  // Exactly the selection: not the base rect, and not the locked frame guide.
  await expect
    .poll(async () => (await readDeck(page))?.slides[0].revealSteps)
    .toEqual([["step-one"]]);

  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByTestId("presentation-counter")).toContainText("0 / 1");
  await expectCentreNot(page, RED);
  await page.keyboard.press("ArrowRight");
  await expectCentre(page, RED);
});

test("deleting a step returns its shapes to the base layer", async ({ page }) => {
  await seedDeck(page, [
    {
      id: "s1",
      title: "Build",
      elements: [BASE_RECT, STEP_ONE_RECT],
      revealSteps: [["step-one"]],
    },
  ]);

  await expect(page.getByTestId("reveal-step-row")).toHaveCount(1);
  await page.getByTestId("reveal-step-row").hover();
  await page.getByRole("button", { name: "Delete step (shapes stay on the slide)" }).click();

  await expect(page.getByTestId("reveal-step-row")).toHaveCount(0);
  await expect.poll(async () => (await readDeck(page))?.slides[0].revealSteps ?? null).toBeNull();

  // The shape itself is untouched and now shows from the start.
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByTestId("presentation-counter")).toHaveText("1 / 1");
  await expectCentre(page, RED);
});

test("reveal steps survive a reload and ignore ids whose shapes were deleted", async ({ page }) => {
  await seedDeck(page, [
    {
      id: "s1",
      title: "Build",
      elements: [BASE_RECT, STEP_ONE_RECT],
      // "ghost" has no element; it must not create a phantom step.
      revealSteps: [["ghost"], ["step-one"]],
    },
  ]);

  await expect(page.getByTestId("reveal-step-row")).toHaveCount(1);

  await page.getByRole("button", { name: "Present", exact: true }).click();
  const counter = page.getByTestId("presentation-counter");
  await expect(counter).toContainText("0 / 1");
  await expectCentreNot(page, RED);
  await page.keyboard.press("ArrowRight");
  await expect(counter).toContainText("1 / 1");
  await expectCentre(page, RED);
});
