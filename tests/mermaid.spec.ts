import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Mermaid conversion runs in-browser; the first conversion loads the mermaid
// chunk, which can be slow in the dev server.
const CONVERT_TIMEOUT = 20_000;

// No addInitScript here: storage is reset explicitly after load so seeded
// tests never depend on the relative order of multiple init scripts.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dexcalidraw" })).toBeVisible();
});

async function createAndOpenPresentation(page: Page) {
  await page.getByRole("button", { name: "New presentation" }).click();
  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeVisible();
}

async function readFirstStoredPresentation(page: Page) {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("excalidraw-video-deck:p:")) {
        return JSON.parse(localStorage.getItem(key) ?? "null");
      }
    }
    return null;
  });
}

async function openMermaidDialog(page: Page) {
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Insert Mermaid diagram" }).click();
  await expect(page.getByRole("dialog", { name: "Insert Mermaid diagram" })).toBeVisible();
}

async function insertMermaid(page: Page, source: string, target: "current" | "new") {
  await page.getByTestId("mermaid-source").fill(source);
  if (target === "new") await page.getByRole("radio", { name: "New slide" }).click();
  await page.getByTestId("mermaid-insert").click();
  await expect(page.getByRole("dialog", { name: "Insert Mermaid diagram" })).not.toBeVisible({
    timeout: CONVERT_TIMEOUT,
  });
}

type StoredElement = { id: string; type: string; link?: string | null };

const FLOWCHART = `flowchart TD
  A[Start] --> B{Sorted?}
  B -- yes --> C[Done]
  B -- no --> D[Split]
  D --> B`;

test("/mermaid opens the dialog and inserts an editable flowchart into the current slide", async ({ page }) => {
  await createAndOpenPresentation(page);

  // / opens the editor command bar with mermaid suggested.
  await page.keyboard.press("/");
  const input = page.getByTestId("command-bar-input");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.type("mermaid");
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Insert Mermaid diagram" });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("mermaid-source")).toBeFocused();

  await page.getByTestId("mermaid-source").fill(FLOWCHART);
  await page.getByTestId("mermaid-insert").click();
  await expect(dialog).not.toBeVisible({ timeout: CONVERT_TIMEOUT });

  // The converted elements are persisted as native shapes, no image fallback.
  await expect.poll(async () =>
    readFirstStoredPresentation(page).then((stored) => stored?.slides[0]?.excalidrawData?.elements?.length ?? 0)
  ).toBeGreaterThan(0);
  const stored = await readFirstStoredPresentation(page);
  const elements: StoredElement[] = stored.slides[0].excalidrawData.elements;
  const types = new Set(elements.map((el) => el.type));
  expect(types.has("image")).toBe(false);
  expect(types.has("rectangle")).toBe(true); // nodes
  expect(types.has("diamond")).toBe(true); // the {Sorted?} decision
  expect(types.has("arrow")).toBe(true); // edges
  expect(types.has("text")).toBe(true); // labels
  expect(Object.keys(stored.slides[0].excalidrawData.files ?? {})).toHaveLength(0);
  expect(stored.slides).toHaveLength(1);

  // The diagram survives a reload with the same persisted elements.
  await page.reload();
  await page.getByTestId("presentation-card").first().click();
  await expect(page.locator(".excalidraw")).toBeVisible();
  const reloaded = await readFirstStoredPresentation(page);
  expect(reloaded.slides[0].excalidrawData.elements.map((el: StoredElement) => el.id)).toEqual(
    elements.map((el) => el.id),
  );
});

test("current-slide insertion is committed immediately — navigating home right away keeps the diagram", async ({ page }) => {
  await createAndOpenPresentation(page);

  await openMermaidDialog(page);
  await insertMermaid(page, FLOWCHART, "current");

  // Go home immediately, before the canvas's 150 ms onChange debounce can
  // fire. The insertion must already be committed and flushed to storage.
  await page.getByTitle("All presentations").click();
  await expect(page.getByRole("heading", { name: "Dexcalidraw" })).toBeVisible();

  const stored = await readFirstStoredPresentation(page);
  const elements: StoredElement[] = stored.slides[0].excalidrawData.elements;
  expect(elements.length).toBeGreaterThan(0);
  expect(elements.some((el) => el.type === "rectangle")).toBe(true);
  expect(elements.some((el) => el.type === "image")).toBe(false);
});

test("current-slide insertion preserves existing elements; new-slide insertion inherits background and frame", async ({ page }) => {
  const now = Date.now();
  await page.evaluate((now) => {
    const marker = {
      id: "marker-rect",
      type: "rectangle",
      x: 40,
      y: 40,
      width: 120,
      height: 80,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: now,
      link: null,
      locked: false,
    };
    localStorage.setItem("excalidraw-video-deck:p:mermaid-deck", JSON.stringify({
      id: "mermaid-deck",
      title: "Mermaid deck",
      slides: [{
        id: "slide-1",
        title: "Slide 1",
        excalidrawData: {
          elements: [marker],
          appState: { viewBackgroundColor: "#fff9c4" },
          files: {},
        },
        videoBlocks: [],
        notes: "",
        presentationFrame: { x: 100, y: 50, width: 1600, height: 900 },
      }],
      currentSlideId: "slide-1",
      createdAt: now,
      updatedAt: now,
    }));
  }, now);
  await page.reload();
  await page.getByTestId("presentation-card").filter({ hasText: "Mermaid deck" }).click();
  await expect(page.locator(".excalidraw")).toBeVisible();

  // Discoverability path: the More menu opens the same dialog.
  await openMermaidDialog(page);
  await insertMermaid(page, FLOWCHART, "current");

  // The pre-existing element survives alongside the inserted diagram.
  await expect.poll(async () =>
    readFirstStoredPresentation(page).then((s) => s?.slides[0]?.excalidrawData?.elements?.length ?? 0)
  ).toBeGreaterThan(1);
  const afterCurrent = await readFirstStoredPresentation(page);
  const currentElements: StoredElement[] = afterCurrent.slides[0].excalidrawData.elements;
  expect(currentElements.some((el) => el.id === "marker-rect")).toBe(true);
  expect(currentElements.some((el) => el.type === "image")).toBe(false);

  // New-slide insertion lands after the current slide and inherits styling.
  await openMermaidDialog(page);
  await insertMermaid(page, FLOWCHART, "new");

  await expect(page.getByTestId("slide-title")).toHaveCount(2);
  await expect.poll(async () =>
    readFirstStoredPresentation(page).then((s) => s?.slides[1]?.excalidrawData?.elements?.length ?? 0)
  ).toBeGreaterThan(0);
  const afterNew = await readFirstStoredPresentation(page);
  expect(afterNew.slides).toHaveLength(2);
  expect(afterNew.currentSlideId).toBe(afterNew.slides[1].id);
  expect(afterNew.slides[1].excalidrawData.appState.viewBackgroundColor).toBe("#fff9c4");
  expect(afterNew.slides[1].presentationFrame).toEqual({ x: 100, y: 50, width: 1600, height: 900 });
  const newSlideElements: StoredElement[] = afterNew.slides[1].excalidrawData.elements;
  expect(newSlideElements.some((el) => el.type === "image")).toBe(false);
  expect(newSlideElements.some((el) => el.id === "marker-rect")).toBe(false);
  // The first slide kept exactly what it had after the first insertion.
  expect(afterNew.slides[0].excalidrawData.elements.map((el: StoredElement) => el.id)).toEqual(
    currentElements.map((el) => el.id),
  );
});

test("all advertised diagram types convert to editable shapes; image-only types are rejected", async ({ page }) => {
  const supported: [string, string][] = [
    ["sequence", "sequenceDiagram\n  Alice->>Bob: Request\n  Bob-->>Alice: Response"],
    ["class", "classDiagram\n  class Animal\n  Animal <|-- Dog"],
    ["ER", "erDiagram\n  CUSTOMER ||--o{ ORDER : places"],
    ["state", "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running : start"],
  ];

  await createAndOpenPresentation(page);
  for (const [, source] of supported) {
    await openMermaidDialog(page);
    await insertMermaid(page, source, "new");
  }

  await expect(page.getByTestId("slide-title")).toHaveCount(1 + supported.length);
  const stored = await readFirstStoredPresentation(page);
  for (let i = 1; i <= supported.length; i++) {
    const elements: StoredElement[] = stored.slides[i].excalidrawData.elements;
    expect(elements.length, `${supported[i - 1][0]} diagram should produce elements`).toBeGreaterThan(0);
    expect(
      elements.some((el) => el.type === "image"),
      `${supported[i - 1][0]} diagram must not fall back to an image`,
    ).toBe(false);
  }

  // gantt only renders as an image and must be rejected, not inserted.
  await openMermaidDialog(page);
  await page.getByTestId("mermaid-source").fill("gantt\n  title Plan\n  section Work\n  Task :a1, 2024-01-01, 3d");
  await page.getByTestId("mermaid-insert").click();
  await expect(page.getByTestId("mermaid-error")).toBeVisible({ timeout: CONVERT_TIMEOUT });
  await expect(page.getByTestId("mermaid-error")).toContainText("only be rendered as an image");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Insert Mermaid diagram" })).not.toBeVisible();
  const after = await readFirstStoredPresentation(page);
  expect(after.slides).toHaveLength(1 + supported.length);
});

test("strict Mermaid conversion strips script links and preserves ordinary web links", async ({ page }) => {
  await createAndOpenPresentation(page);
  await openMermaidDialog(page);
  await insertMermaid(page, `flowchart TD
  Safe[Safe documentation] --> Unsafe[Unsafe link]
  click Safe "https://example.com/docs"
  click Unsafe "javascript:alert(1)"`, "current");

  const stored = await readFirstStoredPresentation(page);
  const elements: StoredElement[] = stored.slides[0].excalidrawData.elements;
  const links = elements.flatMap((element) => element.link ? [element.link] : []);
  expect(links).toContain("https://example.com/docs");
  expect(links.some((link) => /^javascript:/i.test(link))).toBe(false);
});

test("invalid Mermaid input shows an inline error and leaves the deck unchanged", async ({ page }) => {
  await createAndOpenPresentation(page);
  const before = await readFirstStoredPresentation(page);

  await page.keyboard.press("/");
  await page.keyboard.type("mermaid");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Insert Mermaid diagram" });
  await expect(dialog).toBeVisible();

  await page.getByTestId("mermaid-source").fill("this is definitely not a mermaid diagram %%%");
  await page.getByTestId("mermaid-insert").click();

  // The error appears inline; the dialog stays open with the source intact.
  await expect(page.getByTestId("mermaid-error")).toBeVisible({ timeout: CONVERT_TIMEOUT });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("mermaid-source")).toHaveValue(
    "this is definitely not a mermaid diagram %%%",
  );

  // Nothing was inserted or persisted.
  const after = await readFirstStoredPresentation(page);
  expect(after.slides[0].excalidrawData.elements).toEqual(before.slides[0].excalidrawData.elements);
  expect(after.slides).toHaveLength(before.slides.length);

  // Escape closes without touching the deck.
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("mermaid elements survive a ZIP export/import round trip", async ({ page }, testInfo) => {
  await createAndOpenPresentation(page);

  await openMermaidDialog(page);
  await insertMermaid(page, FLOWCHART, "current");
  await expect.poll(async () =>
    readFirstStoredPresentation(page).then((s) => s?.slides[0]?.excalidrawData?.elements?.length ?? 0)
  ).toBeGreaterThan(0);
  const before = await readFirstStoredPresentation(page);
  const beforeTypes = before.slides[0].excalidrawData.elements.map((el: StoredElement) => el.type).sort();

  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("menuitem", { name: "Export backup" })).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export backup" }).click(),
  ]);
  const bundlePath = testInfo.outputPath("mermaid-deck.zip");
  await download.saveAs(bundlePath);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(bundlePath);

  // Import rekeys slides, so wait for the slide id to change before comparing.
  await expect.poll(async () =>
    readFirstStoredPresentation(page).then((s) => s?.slides[0]?.id)
  ).not.toBe(before.slides[0].id);
  const after = await readFirstStoredPresentation(page);
  const afterTypes = after.slides[0].excalidrawData.elements.map((el: StoredElement) => el.type).sort();
  expect(afterTypes).toEqual(beforeTypes);
  expect(afterTypes).not.toContain("image");
});
