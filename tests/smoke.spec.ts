import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { writeFile, readFile } from "node:fs/promises";
import { zipSync, unzipSync } from "fflate";

// Clear localStorage before each test so every scenario starts from the
// default presentation regardless of what a previous test left behind. Also
// mark the demo deck as already seeded (persists across this page's own
// later clear()+goto/reload calls too, since addInitScript reruns on every
// navigation) so tests see a genuinely empty dashboard rather than the
// auto-created sample deck real first-time visitors get.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("excalidraw-video-deck:demo-seeded", "1");
  });
  await page.goto("/");
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

type StoredVideoRecord =
  | { kind: "blob"; type: string; size: number; base64: string }
  | { kind: "string"; value: string }
  | { kind: "missing" };

async function readStoredVideoRecord(page: Page, videoId: string): Promise<StoredVideoRecord> {
  return page.evaluate(async (id) => {
    const record = await new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open("excalidraw-video-deck-blobs", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("videos", "readonly");
        const req = tx.objectStore("videos").get(id);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      };
    });
    if (record instanceof Blob) {
      const bytes = new Uint8Array(await record.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { kind: "blob" as const, type: record.type, size: record.size, base64: btoa(binary) };
    }
    if (typeof record === "string") return { kind: "string" as const, value: record };
    return { kind: "missing" as const };
  }, videoId);
}

async function readStoredFontSize(page: Page, deckId: string): Promise<number | undefined> {
  return page.evaluate((id) => {
    const stored = JSON.parse(localStorage.getItem(`excalidraw-video-deck:p:${id}`) ?? "null");
    return stored?.slides?.[0]?.excalidrawData?.elements?.find(
      (el: { id?: string }) => el.id === "text-1",
    )?.fontSize as number | undefined;
  }, deckId);
}

test("home creates and reopens a presentation", async ({ page }) => {
  await expect(page.getByText("No presentations yet")).toBeVisible();
  await createAndOpenPresentation(page);
  await expect(page.getByTestId("slide-title").first()).toHaveValue("Slide 1");

  await page.getByTitle("All presentations").click();
  await expect(page.getByText("Untitled Presentation")).toBeVisible();
  await page.getByTestId("presentation-card").filter({ hasText: "Untitled Presentation" }).click();
  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeVisible();
});

test("marks a deck as a template and creates an independent presentation from it", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("textbox").first().fill("Lesson layout");

  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Save as template" }).click();
  await expect(page.getByText("Template", { exact: true })).toBeVisible();

  await page.getByTitle("All presentations").click();
  await expect(page.getByText("Templates", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use template" }).click();
  await expect(page.getByRole("dialog", { name: "Create from template" })).toBeVisible();
  await page.getByRole("button", { name: "Create presentation" }).click();

  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeVisible();
  await expect(page.getByText("Template", { exact: true })).not.toBeVisible();
  await page.getByTitle("All presentations").click();

  const stored = await page.evaluate(() =>
    Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key?.startsWith("excalidraw-video-deck:p:") === true)
      .map((key) => JSON.parse(localStorage.getItem(key) ?? "null"))
  );
  expect(stored).toHaveLength(2);
  expect(stored.filter((deck) => deck.isTemplate)).toHaveLength(1);
  expect(stored.filter((deck) => !deck.isTemplate)).toHaveLength(1);
  expect(new Set(stored.map((deck) => deck.id)).size).toBe(2);
  expect(new Set(stored.map((deck) => deck.slides[0].id)).size).toBe(2);
});

test("undoing a delete restores the deck, and the trash panel supports restore", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("textbox").first().fill("Keep me");
  await page.getByTitle("All presentations").click();

  await createAndOpenPresentation(page);
  await page.getByRole("textbox").first().fill("Trash me");
  await page.getByTitle("All presentations").click();

  const trashMeCard = page.getByTestId("presentation-card").filter({ hasText: "Trash me" });
  const keepMeCard = page.getByTestId("presentation-card").filter({ hasText: "Keep me" });
  // The delete button lives on the <article> wrapper, a sibling of the
  // clickable testid'd div, not a descendant of it.
  const trashMeArticle = page.locator("article").filter({ has: trashMeCard });

  // Deleting a presentation is undoable, so it shows no confirmation dialog;
  // Undo and the trash panel are the safety net instead.
  await trashMeArticle.hover();
  await trashMeArticle.getByTitle("Move to trash").click();
  await expect(page.getByRole("status").filter({ hasText: "moved to trash" })).toContainText("Trash me");
  await expect(trashMeCard).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(trashMeCard).toBeVisible();
  await expect(keepMeCard).toBeVisible();

  // Delete again and recover it from the trash panel instead of the toast.
  await trashMeArticle.hover();
  await trashMeArticle.getByTitle("Move to trash").click();
  await expect(trashMeCard).toHaveCount(0);
  await expect(keepMeCard).toBeVisible();

  await page.getByRole("button", { name: "Trash (1)" }).click();
  await expect(page.getByRole("dialog", { name: "Trash" })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await expect(trashMeCard).toBeVisible();
  await expect(page.getByRole("button", { name: /^Trash \(/ })).toHaveCount(0);
});

test("permanently deleting from the trash removes the deck's stored videos", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("textbox").first().fill("Trash me");

  await page.locator('input[accept="video/webm,video/mp4,video/quicktime"]').first().setInputFiles({
    name: "clip.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("tiny-fake-video-bytes"),
  });
  await expect(page.locator("video")).toHaveAttribute("src", /^blob:/);
  const videoId: string = await readFirstStoredPresentation(page)
    .then((stored) => stored.slides[0].videoBlocks[0].id);

  await page.getByTitle("All presentations").click();
  const trashMeCard = page.getByTestId("presentation-card").filter({ hasText: "Trash me" });
  const trashMeArticle = page.locator("article").filter({ has: trashMeCard });
  await trashMeArticle.hover();
  await trashMeArticle.getByTitle("Move to trash").click();

  // Moving to trash must not touch the video Blob; only a permanent delete does.
  expect((await readStoredVideoRecord(page, videoId)).kind).toBe("blob");

  await page.getByRole("button", { name: "Trash (1)" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete forever" }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await expect(trashMeCard).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Trash \(/ })).toHaveCount(0);
  await expect.poll(async () => (await readStoredVideoRecord(page, videoId)).kind).toBe("missing");

  const stored = await page.evaluate(() =>
    Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .some((key) => key?.startsWith("excalidraw-video-deck:p:") === true)
  );
  expect(stored).toBe(false);
});

test("copies template videos to independent IndexedDB keys", async ({ page }) => {
  const videoSrc = "data:video/webm;base64,AAAA";
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem("excalidraw-video-deck:p:video-template", JSON.stringify({
      id: "video-template",
      title: "Video template",
      slides: [{
        id: "template-slide",
        title: "Demo",
        excalidrawData: { elements: [], appState: {}, files: {} },
        videoBlocks: [{
          id: "template-video",
          name: "demo.webm",
          src: "",
          fileName: "demo.webm",
          mimeType: "video/webm",
          x: 0.1,
          y: 0.1,
          width: 0.4,
          height: 0.35,
          objectFit: "contain",
          autoplay: false,
          loop: false,
          muted: false,
        }],
        notes: "",
      }],
      currentSlideId: "template-slide",
      createdAt: now,
      updatedAt: now,
      isTemplate: true,
    }));
  });
  await page.goto("/");
  await page.evaluate(async ({ videoSrc }) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("excalidraw-video-deck-blobs", 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("videos")) {
          open.result.createObjectStore("videos");
        }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("videos", "readwrite");
        tx.objectStore("videos").put(videoSrc, "template-video");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { videoSrc });

  await page.getByRole("button", { name: "Use template" }).click();
  await page.getByRole("checkbox", { name: "Carry over video files" }).check();
  await page.getByRole("button", { name: "Create presentation" }).click();
  await expect(page.getByText("demo.webm")).toBeVisible();

  const copiedId: string = await page.evaluate(() => {
    const decks = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key?.startsWith("excalidraw-video-deck:p:") === true)
      .map((key) => JSON.parse(localStorage.getItem(key) ?? "null"));
    const deck = decks.find((candidate) => !candidate.isTemplate);
    return deck?.slides[0]?.videoBlocks[0]?.id;
  });

  expect(copiedId).not.toBe("template-video");
  // The template's legacy data-URL record is converted to an independent Blob
  // record for the copy ("AAAA" decodes to three zero bytes and re-encodes
  // identically).
  const copied = await readStoredVideoRecord(page, copiedId);
  expect(copied).toMatchObject({ kind: "blob", type: "video/webm", base64: "AAAA" });
});

test("app loads with default slide", async ({ page }) => {
  await createAndOpenPresentation(page);
  // Sidebar shows the first slide title in an editable input.
  await expect(page.getByTestId("slide-title").first()).toHaveValue("Slide 1");
  // Editor canvas is present (the Excalidraw wrapper div is rendered).
  await expect(page.locator(".excalidraw")).toBeVisible();
});

test("add slide", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Add slide" }).click();
  // A second slide should appear in the sidebar.
  await expect(page.getByTestId("slide-title").nth(1)).toHaveValue("Slide 2");
});

test("duplicate slide creates an independent copy", async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem("excalidraw-video-deck:presentation", JSON.stringify({
      id: "deck-1",
      title: "Deck",
      slides: [{
        id: "slide-1",
        title: "Original",
        excalidrawData: { elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} },
        videoBlocks: [{
          id: "video-1",
          name: "Clip",
          src: "data:video/webm;base64,AAAA",
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.3,
          objectFit: "contain",
          autoplay: false,
          loop: false,
          muted: true,
          breakpoints: [1.5, 3],
        }],
        notes: "speaker notes",
        presentationFrame: { x: 10, y: 20, width: 1600, height: 900 },
      }],
      currentSlideId: "slide-1",
      createdAt: now,
      updatedAt: now,
    }));
  });
  await page.goto("/");
  await page.getByTestId("presentation-card").filter({ hasText: "Deck" }).click();
  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeVisible();

  await page.getByTestId("slide-thumbnail").hover();
  await page.getByTitle("Duplicate slide").click();

  await expect(page.getByTestId("slide-title")).toHaveCount(2);
  await expect(page.getByTestId("slide-title").nth(1)).toHaveValue("Original (copy)");

  const stored = await readFirstStoredPresentation(page);
  expect(stored.slides[1].id).not.toBe(stored.slides[0].id);
  expect(stored.slides[1].videoBlocks[0].id).not.toBe(stored.slides[0].videoBlocks[0].id);
  expect(stored.slides[1].videoBlocks[0].breakpoints).toEqual([1.5, 3]);

  // The copy owns an independent Blob record with the same bytes.
  const copiedRecord = await readStoredVideoRecord(page, stored.slides[1].videoBlocks[0].id);
  expect(copiedRecord).toMatchObject({ kind: "blob", type: "video/webm", base64: "AAAA" });
  // Both the original and the copy play from blob: URLs.
  for (const video of await page.locator("video").all()) {
    expect(await video.getAttribute("src")).toMatch(/^blob:/);
  }
});

test("migrates embedded video srcs to IndexedDB and strips localStorage", async ({ page }) => {
  const videoId = `video-migration-${Date.now()}`;
  const src = "data:video/webm;base64,AAAA";
  await page.addInitScript(
    ({ videoId, src }) => {
      const now = Date.now();
      localStorage.setItem("excalidraw-video-deck:presentation", JSON.stringify({
        id: "deck-migration",
        title: "Deck",
        slides: [{
          id: "slide-migration",
          title: "Video Slide",
          excalidrawData: { elements: [], appState: {}, files: {} },
          videoBlocks: [{
            id: videoId,
            name: "Clip",
            src,
            x: 0.1,
            y: 0.1,
            width: 0.3,
            height: 0.3,
            objectFit: "contain",
            autoplay: false,
            loop: false,
            muted: true,
          }],
          notes: "",
        }],
        currentSlideId: "slide-migration",
        createdAt: now,
        updatedAt: now,
      }));
    },
    { videoId, src },
  );
  await page.goto("/");
  await page.getByTestId("presentation-card").filter({ hasText: "Deck" }).click();

  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("menuitem", { name: "Export backup" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect.poll(async () =>
    readFirstStoredPresentation(page).then((stored) => stored?.slides[0]?.videoBlocks[0]?.src)
  ).toBe("");
  await expect.poll(async () =>
    page.evaluate(() => localStorage.getItem("excalidraw-video-deck:presentation"))
  ).toBeNull();

  // The embedded data URL is migrated to a Blob record, and the in-memory
  // deck plays it via a runtime blob: URL.
  const record = await readStoredVideoRecord(page, videoId);
  expect(record).toMatchObject({ kind: "blob", type: "video/webm", base64: "AAAA" });
  await expect(page.locator("video").first()).toHaveAttribute("src", /^blob:/);
});

test("stores an added video as a Blob and plays it via blob: URLs across reloads", async ({ page, context }) => {
  await createAndOpenPresentation(page);

  await page.locator('input[accept="video/webm,video/mp4,video/quicktime"]').first().setInputFiles({
    name: "clip.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("tiny-fake-video-bytes"),
  });

  // Playback uses a runtime object URL, never an embedded payload.
  await expect(page.locator("video").first()).toHaveAttribute("src", /^blob:/);

  // The persisted metadata has src stripped; the payload is a Blob record.
  await expect.poll(async () =>
    readFirstStoredPresentation(page).then((stored) => stored?.slides[0]?.videoBlocks[0]?.src)
  ).toBe("");
  const videoId: string = await readFirstStoredPresentation(page)
    .then((stored) => stored.slides[0].videoBlocks[0].id);
  const record = await readStoredVideoRecord(page, videoId);
  expect(record).toMatchObject({
    kind: "blob",
    type: "video/webm",
    base64: Buffer.from("tiny-fake-video-bytes").toString("base64"),
  });

  // A fresh page (beforeEach's localStorage-clearing init script does not
  // apply to it) re-hydrates the video from the stored Blob.
  const reopened = await context.newPage();
  await reopened.goto("/");
  await reopened.getByTestId("presentation-card").first().click();
  await expect(reopened.locator("video").first()).toHaveAttribute("src", /^blob:/);
  await reopened.close();
});

test("revokes the blob URL and removes the record when a video is deleted", async ({ page }) => {
  await createAndOpenPresentation(page);

  await page.locator('input[accept="video/webm,video/mp4,video/quicktime"]').first().setInputFiles({
    name: "clip.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("tiny-fake-video-bytes"),
  });

  const video = page.locator("video").first();
  await expect(video).toHaveAttribute("src", /^blob:/);
  const url = (await video.getAttribute("src"))!;
  const videoId: string = await readFirstStoredPresentation(page)
    .then((stored) => stored.slides[0].videoBlocks[0].id);

  // Sanity: the object URL is fetchable while the video exists.
  expect(await page.evaluate((u) => fetch(u).then(() => true, () => false), url)).toBe(true);

  // Select the video overlay (the <video> itself is pointer-events-none, so
  // click its wrapper), then delete it (confirm dialog).
  await video.locator("..").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTitle("Delete video").click();
  await expect(page.locator("video")).toHaveCount(0);

  // Regression: the object URL must be revoked and the Blob record deleted.
  expect(await page.evaluate((u) => fetch(u).then(() => true, () => false), url)).toBe(false);
  await expect.poll(async () => (await readStoredVideoRecord(page, videoId)).kind).toBe("missing");
});

test("migrates a legacy IndexedDB data-URL string record to a Blob on load", async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem("excalidraw-video-deck:p:legacy-idb", JSON.stringify({
      id: "legacy-idb",
      title: "Legacy IDB deck",
      slides: [{
        id: "slide-1",
        title: "Video Slide",
        excalidrawData: { elements: [], appState: {}, files: {} },
        videoBlocks: [{
          id: "legacy-video",
          name: "Clip",
          src: "",
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.3,
          objectFit: "contain",
          autoplay: false,
          loop: false,
          muted: true,
        }],
        notes: "",
      }],
      currentSlideId: "slide-1",
      createdAt: now,
      updatedAt: now,
    }));
  });
  await page.goto("/");
  // Seed an old-format string record (data URL) before opening the deck.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("excalidraw-video-deck-blobs", 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("videos")) {
          open.result.createObjectStore("videos");
        }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("videos", "readwrite");
        tx.objectStore("videos").put("data:video/webm;base64,AAAA", "legacy-video");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  await page.getByTestId("presentation-card").filter({ hasText: "Legacy IDB deck" }).click();

  // Playback works via a blob: URL and the record is overwritten as a Blob.
  await expect(page.locator("video").first()).toHaveAttribute("src", /^blob:/);
  await expect.poll(async () => (await readStoredVideoRecord(page, "legacy-video")).kind).toBe("blob");
  const record = await readStoredVideoRecord(page, "legacy-video");
  expect(record).toMatchObject({ kind: "blob", type: "video/webm", base64: "AAAA" });
});

test("exports a bundle and reimports it with the video intact", async ({ page }, testInfo) => {
  await createAndOpenPresentation(page);

  await page.locator('input[accept="video/webm,video/mp4,video/quicktime"]').first().setInputFiles({
    name: "clip.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("tiny-fake-video-bytes"),
  });

  await expect.poll(async () =>
    readFirstStoredPresentation(page).then((stored) => stored?.slides[0]?.videoBlocks[0]?.id)
  ).not.toBeUndefined();
  const beforeVideoId: string = await readFirstStoredPresentation(page)
    .then((stored) => stored.slides[0].videoBlocks[0].id);
  const beforeRecord = await readStoredVideoRecord(page, beforeVideoId);
  expect(beforeRecord).toMatchObject({
    kind: "blob",
    type: "video/webm",
    base64: Buffer.from("tiny-fake-video-bytes").toString("base64"),
  });

  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("menuitem", { name: "Export backup" })).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export backup" }).click(),
  ]);
  const bundlePath = testInfo.outputPath("deck-backup.zip");
  await download.saveAs(bundlePath);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(bundlePath);

  await expect.poll(async () =>
    readFirstStoredPresentation(page).then((stored) => stored?.slides[0]?.videoBlocks[0]?.id)
  ).not.toBe(beforeVideoId);

  // The reimported video is an independent Blob record with identical bytes
  // and mime type, playable via a fresh blob: URL.
  const afterVideoId: string = await readFirstStoredPresentation(page)
    .then((stored) => stored.slides[0].videoBlocks[0].id);
  const afterRecord = await readStoredVideoRecord(page, afterVideoId);
  expect(afterRecord).toEqual(beforeRecord);
  await expect(page.locator("video").first()).toHaveAttribute("src", /^blob:/);
  // The replaced deck's old record was cleaned up.
  await expect.poll(async () => (await readStoredVideoRecord(page, beforeVideoId)).kind).toBe("missing");
});

test("rejects a malformed bundle without touching the current deck or its stored video", async ({ page }, testInfo) => {
  await createAndOpenPresentation(page);

  await page.locator('input[accept="video/webm,video/mp4,video/quicktime"]').first().setInputFiles({
    name: "clip.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("tiny-fake-video-bytes"),
  });

  await expect.poll(async () =>
    readFirstStoredPresentation(page).then((stored) => stored?.slides[0]?.videoBlocks[0]?.id)
  ).not.toBeUndefined();
  const videoId: string = await readFirstStoredPresentation(page)
    .then((stored) => stored.slides[0].videoBlocks[0].id);
  const beforeRecord = await readStoredVideoRecord(page, videoId);
  expect(beforeRecord.kind).toBe("blob");
  const beforeStored = await readFirstStoredPresentation(page);

  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("menuitem", { name: "Export backup" })).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export backup" }).click(),
  ]);
  const bundlePath = testInfo.outputPath("deck-backup.zip");
  await download.saveAs(bundlePath);

  // Corrupt the bundle: strip out the video's own binary entry so the
  // manifest references an asset that no longer exists in the zip.
  const unzipped = unzipSync(await readFile(bundlePath));
  delete unzipped["videos/0"];
  const corruptedPath = testInfo.outputPath("deck-backup-corrupted.zip");
  await writeFile(corruptedPath, zipSync(unzipped));

  const dialogMessages: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(corruptedPath);

  await expect.poll(() => dialogMessages.length).toBeGreaterThanOrEqual(2);
  expect(dialogMessages[1]).toMatch(/missing data/);

  // Second corruption variant: flip one byte inside the stored video payload
  // (the entry itself still exists). Import must fail the checksum.
  const bundleBytes = await readFile(bundlePath);
  const payloadOffset = bundleBytes.indexOf(Buffer.from("tiny-fake-video-bytes"));
  expect(payloadOffset).toBeGreaterThan(-1);
  bundleBytes[payloadOffset + 2] ^= 0xff;
  const flippedPath = testInfo.outputPath("deck-backup-flipped.zip");
  await writeFile(flippedPath, bundleBytes);
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(flippedPath);

  await expect.poll(() => dialogMessages.length).toBeGreaterThanOrEqual(4);
  expect(dialogMessages[3]).toMatch(/corrupted/);

  // Both the visible deck and the IndexedDB video payload must be untouched.
  const afterStored = await readFirstStoredPresentation(page);
  expect(afterStored.slides[0].videoBlocks[0].id).toBe(videoId);
  expect(afterStored.title).toBe(beforeStored.title);
  const afterRecord = await readStoredVideoRecord(page, videoId);
  expect(afterRecord).toEqual(beforeRecord);
});

test("can delete the last slide and recover from an empty deck", async ({ page, context }) => {
  await createAndOpenPresentation(page);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("delete-slide").click();

  await expect(page.getByTestId("slide-title")).toHaveCount(0);
  await expect(page.getByText("No slide selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add Video" })).toBeDisabled();
  await expect.poll(async () =>
    readFirstStoredPresentation(page).then((stored) => stored?.slides.length)
  ).toBe(0);

  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(reopened.getByText("Untitled Presentation")).toBeVisible();
  await reopened.getByTestId("presentation-card").filter({ hasText: "Untitled Presentation" }).click();
  await expect(reopened.getByRole("button", { name: "Present", exact: true })).toBeDisabled();
  await expect(reopened.getByTestId("slide-title")).toHaveCount(0);

  await reopened.getByRole("button", { name: "Add slide" }).click();
  await expect(reopened.getByTestId("slide-title")).toHaveCount(1);
  await expect(reopened.getByTestId("slide-title").first()).toHaveValue("Slide 1");
  await expect(reopened.getByRole("button", { name: "Present", exact: true })).toBeEnabled();
  await reopened.close();
});

test("rename slide", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByTestId("slide-title").first().fill("My Renamed Slide");
  // The new title should be reflected immediately.
  await expect(page.getByTestId("slide-title").first()).toHaveValue("My Renamed Slide");
});

test("[ and ] resize selected text without taking over modifier shortcuts", async ({ page }) => {
  const now = Date.now();
  const deckId = "font-shortcut";
  await page.addInitScript(
    ({ deckId, now }) => {
      const textElement = {
        id: "text-1",
        type: "text",
        x: 100,
        y: 100,
        width: 140,
        height: 32,
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
        text: "Hello",
        originalText: "Hello",
        fontSize: 20,
        fontFamily: 5,
        textAlign: "left",
        verticalAlign: "top",
        baseline: 24,
        containerId: null,
        lineHeight: 1.25,
      };
      const deck = {
        id: deckId,
        title: "Font shortcut",
        slides: [{
          id: "slide-1",
          title: "Slide 1",
          excalidrawData: {
            elements: [textElement],
            appState: { viewBackgroundColor: "#ffffff" },
            files: {},
          },
          videoBlocks: [],
          notes: "",
          presentationFrame: { x: 0, y: 0, width: 1600, height: 900 },
        }],
        currentSlideId: "slide-1",
        createdAt: now,
        updatedAt: now,
      };
      localStorage.clear();
      localStorage.setItem(`excalidraw-video-deck:p:${deckId}`, JSON.stringify(deck));
    },
    { deckId, now },
  );
  await page.goto("/");
  await page.getByTestId("presentation-card").filter({ hasText: "Font shortcut" }).click();
  await expect(page.locator(".excalidraw")).toBeVisible();
  await page.waitForTimeout(500); // let Excalidraw initialize and scroll into position

  // Click the canvas to give Excalidraw keyboard focus, then select all.
  // The frame guide is locked so Ctrl/Cmd+A picks up only the text element.
  await page.locator(".excalidraw").first().click();
  await page.keyboard.press("ControlOrMeta+a");

  // ] steps font size from 20 → 28.
  await page.keyboard.press("]");
  await expect.poll(() => readStoredFontSize(page, deckId)).toBe(28);

  // [ steps back from 28 → 20.
  await page.keyboard.press("[");
  await expect.poll(() => readStoredFontSize(page, deckId)).toBe(20);

  // Ctrl/Cmd+] must NOT change font size (modifier guard).
  await page.keyboard.press("ControlOrMeta+]");
  await page.waitForTimeout(250);
  expect(await readStoredFontSize(page, deckId)).toBe(20);
});

test("sidebar shows thumbnail cards", async ({ page }) => {
  await createAndOpenPresentation(page);
  // Each slide card has a thumbnail area above the title input.
  await expect(page.getByTestId("slide-thumbnail")).toHaveCount(1);

  // Adding a slide appends a new thumbnail card.
  await page.getByRole("button", { name: "Add slide" }).click();
  await expect(page.getByTestId("slide-thumbnail")).toHaveCount(2);
});

test("notes indicator appears in thumbnail", async ({ page }) => {
  await createAndOpenPresentation(page);
  await expect(page.getByText("✎")).not.toBeVisible();

  await page.getByPlaceholder("Speaker notes…").fill("hello");
  await expect(page.getByText("✎")).toBeVisible();

  await page.getByPlaceholder("Speaker notes…").fill("");
  await expect(page.getByText("✎")).not.toBeVisible();
});

test("notes window renders slide drawing notes", async ({ page }) => {
  const now = Date.now();
  await page.addInitScript((now) => {
    const noteRect = {
      id: "note-rect",
      type: "rectangle",
      x: 20,
      y: 20,
      width: 100,
      height: 70,
      angle: 0,
      strokeColor: "#a78bfa",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
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
    const deck = {
      id: "notes-drawing",
      title: "Notes drawing",
      slides: [{
        id: "slide-1",
        title: "Slide 1",
        excalidrawData: { elements: [], appState: {}, files: {} },
        videoBlocks: [],
        notes: "",
        notesDrawing: {
          elements: [noteRect],
          appState: { collaborators: {} },
          files: {},
        },
      }],
      currentSlideId: "slide-1",
      createdAt: now,
      updatedAt: now,
    };
    localStorage.clear();
    localStorage.setItem("excalidraw-video-deck:p:notes-drawing", JSON.stringify(deck));
  }, now);

  await page.goto("/?notes&id=notes-drawing");
  await expect(page.getByText("No notes for this slide.")).not.toBeVisible();
  await expect(page.locator(".excalidraw")).toBeVisible();
});

test("notes window disconnect is detected, flashes the toolbar, and reopening recovers it", async ({ page, context }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();

  const topControls = page.getByTestId("presentation-top-controls");
  const notesButton = page.getByTestId("notes-button");
  await expect(topControls).toBeVisible(); // orientation flash
  await expect(notesButton).toHaveAttribute("data-status", "idle");

  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    notesButton.click(),
  ]);
  await popup.waitForLoadState();
  await expect(notesButton).toHaveAttribute("data-status", "open");

  // Move off the top edge so the pointer's last position doesn't itself keep
  // the toolbar pinned once the orientation flash expires.
  await page.mouse.move(200, 400);
  await page.waitForTimeout(2700);
  await expect(topControls).toBeHidden();

  await popup.close();

  // Detected on the next ~1.5s poll tick; the toolbar flashes back into view
  // on its own so the presenter notices without hunting for it.
  await expect(notesButton).toHaveAttribute("data-status", "closed", { timeout: 3000 });
  await expect(topControls).toBeVisible();

  const [popup2] = await Promise.all([
    context.waitForEvent("page"),
    notesButton.click(),
  ]);
  await popup2.waitForLoadState();
  await expect(notesButton).toHaveAttribute("data-status", "open");
});

test("enter presentation mode", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  // Slide counter is the clearest signal that PresentationView is active.
  await expect(page.getByText("1 / 1")).toBeVisible();
  // Editor chrome (TopBar) is gone.
  await expect(page.getByRole("button", { name: "Present", exact: true })).not.toBeVisible();
});

test("help overlay opens and closes", async ({ page }) => {
  await createAndOpenPresentation(page);
  // Overlay is not present before opening.
  await expect(page.getByText("Shortcuts")).not.toBeVisible();

  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(page.getByText("Shortcuts")).toBeVisible();

  // Close with the ✕ button.
  await page.getByRole("button", { name: "Close help" }).click();
  await expect(page.getByText("Shortcuts")).not.toBeVisible();

  // Reopen and close with Escape.
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(page.getByText("Shortcuts")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Shortcuts")).not.toBeVisible();

  // Reopen and close by clicking the backdrop. Radix's outside-pointerdown
  // listener registers via its own internal setTimeout(0) (deliberately, so
  // the click that opens a dialog can't also immediately close it) — after
  // two rapid open/close cycles with zero delay, a scripted click can land
  // before that registration flushes. No real user reopens a dialog and
  // clicks away within a single JS tick, so a tiny settle delay here is
  // matching realistic interaction speed, not masking a real bug (confirmed
  // by fuzzing this exact sequence: 0ms delay flakes ~20-25%, 300ms is 0/8).
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(page.getByText("Shortcuts")).toBeVisible();
  await page.waitForTimeout(50);
  await page.mouse.click(10, 10);
  await expect(page.getByText("Shortcuts")).not.toBeVisible();
});

test("exit presentation mode", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 1")).toBeVisible();

  // Escape is the primary exit path; also tests the keyboard handler.
  await page.keyboard.press("Escape");

  // Back in the editor: TopBar's Present button returns.
  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeVisible();
  await expect(page.getByText("1 / 1")).not.toBeVisible();
});

test("imports Excalidraw frames left to right", async ({ page }, testInfo) => {
  await createAndOpenPresentation(page);
  const filePath = testInfo.outputPath("left-to-right.excalidraw");
  const baseElement = {
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    seed: 1,
    groupIds: [],
    roundness: null,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
  await writeFile(filePath, JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "test",
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
    elements: [
      {
        ...baseElement,
        id: "frame-right",
        type: "frame",
        x: 500,
        y: 0,
        width: 300,
        height: 200,
        name: "Right Frame",
      },
      {
        ...baseElement,
        id: "rect-right",
        type: "rectangle",
        x: 550,
        y: 50,
        width: 80,
        height: 60,
        frameId: "frame-right",
      },
      {
        ...baseElement,
        id: "frame-left",
        type: "frame",
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        name: "Left Frame",
      },
      {
        ...baseElement,
        id: "rect-left",
        type: "rectangle",
        x: 40,
        y: 30,
        width: 80,
        height: 60,
        frameId: "frame-left",
      },
    ],
  }));

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('input[accept=".excalidraw,.json,application/json"]').setInputFiles(filePath);

  await expect(page.getByTestId("slide-title")).toHaveCount(2);
  await expect(page.getByTestId("slide-title").first()).toHaveValue("Left Frame");
  await expect(page.getByTestId("slide-title").nth(1)).toHaveValue("Right Frame");

  const stored = await readFirstStoredPresentation(page);
  expect(stored.slides[0].excalidrawData.elements).toHaveLength(1);
  expect(stored.slides[0].excalidrawData.elements[0]).toMatchObject({
    id: "rect-left",
    x: 40,
    y: 30,
  });
  expect(stored.slides[0].excalidrawData.elements[0]).not.toHaveProperty("frameId");
});

test("laser pointer: Z toggle, cursor hiding, pen exclusivity, and drag tracking", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 1")).toBeVisible();

  const laserBtn = page.getByTitle("Laser pointer (Z)");

  // Z key toggles laser on / off
  await expect(laserBtn).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("z");
  await expect(laserBtn).toHaveAttribute("aria-pressed", "true");

  // Cursor is globally hidden while laser is active
  const cursorHidden = await page.evaluate(() =>
    window.getComputedStyle(document.documentElement).cursor === "none"
  );
  expect(cursorHidden).toBe(true);

  await page.keyboard.press("z"); // deactivate
  await expect(laserBtn).toHaveAttribute("aria-pressed", "false");

  // Pen exclusivity: Z while ink is on must exit ink
  await page.keyboard.press("p"); // enter ink mode
  await page.keyboard.press("z"); // enter laser → ink must be off
  await expect(laserBtn).toHaveAttribute("aria-pressed", "true");

  // Pen exclusivity: P while laser is on must exit laser
  await page.keyboard.press("p"); // enter ink → laser must be off
  await expect(laserBtn).toHaveAttribute("aria-pressed", "false");

  // Drag tracking: dot follows pointermove while mouse button is held
  await page.keyboard.press("Escape"); // exit ink mode (not presentation)
  await page.keyboard.press("z");
  await expect(laserBtn).toHaveAttribute("aria-pressed", "true");

  await page.mouse.move(300, 300); // establish initial position
  await page.mouse.down();
  await page.mouse.move(500, 400); // drag to new position

  // The main dot is updated synchronously in the pointermove handler (no RAF
  // delay), so the transform reflects the final drag position immediately.
  const transform = await page.evaluate(() => {
    const dot = document.querySelector("[style*='box-shadow']");
    return dot instanceof HTMLElement ? dot.style.transform : "";
  });
  // translate(x − 6, y − 6) → translate(494px, 394px)
  expect(transform).toContain("494px");
  expect(transform).toContain("394px");

  await page.mouse.up();
});

test("library installs, persists across reload, survives slide switch, and clears live", async ({ page }) => {
  await createAndOpenPresentation(page);

  // Minimal v2 library with one rectangle element.  Empty elements[] is
  // filtered by restoreLibraryItems, so we include a real shape here.
  const libContent = Buffer.from(
    JSON.stringify({
      type: "excalidrawlib",
      version: 2,
      source: "test",
      libraryItems: [
        {
          id: "test-shape-1",
          status: "published",
          name: "Test Shape",
          created: 1700000000000,
          elements: [
            {
              type: "rectangle",
              version: 1,
              versionNonce: 1,
              isDeleted: false,
              id: "test-el-1",
              fillStyle: "solid",
              strokeWidth: 1,
              strokeStyle: "solid",
              roughness: 1,
              opacity: 100,
              angle: 0,
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              seed: 1,
              groupIds: [],
              strokeColor: "#1e1e1e",
              backgroundColor: "transparent",
              boundElements: null,
              updated: 1700000000000,
              link: null,
              locked: false,
              frameId: null,
              index: "a0",
            },
          ],
        },
      ],
    }),
  );

  // Import directly via the hidden file input (bypasses the file chooser dialog).
  await page.locator('input[accept=".excalidrawlib"]').setInputFiles({
    name: "shapes.excalidrawlib",
    mimeType: "application/json",
    buffer: libContent,
  });

  // Library key appears in localStorage and the live menu reflects the count.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("excalidraw-video-deck:library")))
    .toContain("test-shape-1");
  await page.getByTitle("More options").click();
  await expect(page.getByRole("menuitem", { name: /Clear library \(1/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Slide switch: Excalidraw remounts with initialData.libraryItems, so count must survive.
  await page.getByRole("button", { name: "Add slide" }).click();
  await expect(page.getByTestId("slide-title")).toHaveCount(2);
  await page.getByTitle("More options").click();
  await expect(page.getByRole("menuitem", { name: /Clear library \(1/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Navigate home and back (SPA, no page reload, so beforeEach's localStorage.clear()
  // does not fire). This exercises the loadLibrary() path on deck remount.
  await page.getByTitle("All presentations").click();
  await expect(page.getByRole("heading", { name: "Dexcalidraw" })).toBeVisible();
  await page.getByTestId("presentation-card").first().click();
  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeVisible();
  await page.getByTitle("More options").click();
  await expect(page.getByRole("menuitem", { name: /Clear library \(1/ })).toBeVisible();

  // Clear library: dialog accepted, menu item must vanish immediately (live canvas cleared).
  page.once("dialog", (d) => d.accept());
  await page.getByRole("menuitem", { name: /Clear library/ }).click();

  await expect(page.getByRole("menuitem", { name: /Clear library/ })).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("excalidraw-video-deck:library")))
    .toBeNull();
});

test("Ctrl/Cmd+Z undoes last ink stroke without triggering laser", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 1")).toBeVisible();

  const laserBtn = page.getByTitle("Laser pointer (Z)");
  const penBtn = page.getByTitle("Toggle annotation mode (P)");
  const view = page.getByTestId("presentation-view");

  // Guard: Ctrl+Z must not activate laser
  await page.keyboard.press("ControlOrMeta+z");
  await expect(laserBtn).toHaveAttribute("aria-pressed", "false");

  // Functional: Ctrl+Z undoes the last ink stroke
  await page.keyboard.press("p"); // enter ink mode
  await expect(penBtn).toHaveAttribute("aria-pressed", "true");
  // setActiveTool commits asynchronously inside Excalidraw, so wait for the
  // real freedraw signal before drawing, or the stroke may become a selection drag.
  await expect(view).toHaveAttribute("data-canvas-ink-state", "freedraw:2:100");

  // Draw a freedraw stroke in the safe centre of the screen (away from toolbar).
  await page.mouse.move(350, 250);
  await page.mouse.down();
  await page.mouse.move(450, 350);
  await page.mouse.up();

  // Confirm the stroke was committed via the 150 ms onChange debounce.
  await expect(view).toHaveAttribute("data-ink-count", /^[1-9]/);

  // handleUndoInk removes the last element directly from inkBySlideId (synchronous),
  // so data-ink-count drops to 0 without waiting for an Excalidraw debounce.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(view).toHaveAttribute("data-ink-count", "0");
  await page.keyboard.press("p"); // exit ink mode, count must stay 0
  await expect(view).toHaveAttribute("data-ink-count", "0");
});

test("command bar: open, autocomplete, execute, escape", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 1")).toBeVisible();

  const input = page.getByTestId("command-bar-input");
  const penBtn = page.getByTitle("Toggle annotation mode (P)");
  const laserBtn = page.getByTitle("Laser pointer (Z)");

  // Escape closes without executing
  await page.keyboard.press("/");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(input).not.toBeVisible();
  // mode unchanged
  await expect(penBtn).toHaveAttribute("aria-pressed", "false");

  // Click overlay closes without executing
  await page.keyboard.press("/");
  await expect(input).toBeVisible();
  await page.getByTestId("command-bar-overlay").click({ position: { x: 10, y: 10 } });
  await expect(input).not.toBeVisible();

  // Tab autocompletes the selected suggestion
  await page.keyboard.press("/");
  await page.keyboard.type("l");
  // "laser" is the only match
  await expect(page.locator("[data-testid='command-bar-overlay'] button").first()).toContainText("laser");
  await page.keyboard.press("Tab");
  // input now shows "laser"; Enter executes it
  await expect(input).toHaveValue("laser");
  await page.keyboard.press("Enter");
  await expect(laserBtn).toHaveAttribute("aria-pressed", "true");
  await expect(input).not.toBeVisible();

  // Arrow navigation + Enter executes the selected suggestion
  // laser is active; open bar and use "off" to reset
  await page.keyboard.press("/");
  await page.keyboard.type("off");
  await page.keyboard.press("Enter");
  await expect(laserBtn).toHaveAttribute("aria-pressed", "false");

  // 'pen red' sets ink mode with red color
  await page.keyboard.press("/");
  await expect(input).toBeVisible();
  await page.keyboard.type("pen red");
  await page.keyboard.press("Enter");
  await expect(penBtn).toHaveAttribute("aria-pressed", "true");
  await expect(input).not.toBeVisible();

  // 'off' exits pen mode
  await page.keyboard.press("/");
  await page.keyboard.type("off");
  await page.keyboard.press("Enter");
  await expect(penBtn).toHaveAttribute("aria-pressed", "false");
});

test("command bar: /undo removes last ink stroke", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 1")).toBeVisible();

  const view = page.getByTestId("presentation-view");

  // Draw a stroke in ink mode.
  await page.keyboard.press("p");
  await expect(page.getByTitle("Toggle annotation mode (P)")).toHaveAttribute("aria-pressed", "true");
  await expect(view).toHaveAttribute("data-canvas-ink-state", "freedraw:2:100");
  await page.mouse.move(350, 250);
  await page.mouse.down();
  await page.mouse.move(450, 350);
  await page.mouse.up();
  await expect(view).toHaveAttribute("data-ink-count", /^[1-9]/);

  // /undo via command bar removes the stroke.
  await page.keyboard.press("/");
  await page.keyboard.type("undo");
  await page.keyboard.press("Enter");
  await expect(view).toHaveAttribute("data-ink-count", "0");
});

test("command bar: ControlOrMeta+/ does not open the bar", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 1")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+/");
  await expect(page.getByTestId("command-bar-input")).not.toBeVisible();
});

test("command bar: /pen blue 4 sets ink mode with correct color and width", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 1")).toBeVisible();

  const penBtn = page.getByTitle("Toggle annotation mode (P)");

  await page.keyboard.press("/");
  await page.keyboard.type("pen blue 4");
  await page.keyboard.press("Enter");

  // Pen mode is active.
  await expect(penBtn).toHaveAttribute("aria-pressed", "true");

  // With inkMode on, the picker is in the DOM: check aria-pressed on color and width.
  await expect(page.getByTitle("Blue")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTitle("Stroke width 4")).toHaveAttribute("aria-pressed", "true");
  // Other color/width should not be pressed.
  await expect(page.getByTitle("Red")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTitle("Stroke width 2")).toHaveAttribute("aria-pressed", "false");
});

test("highlighter: /highlight yellow draws translucent ink and H/P switch tools", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 1")).toBeVisible();

  const view = page.getByTestId("presentation-view");
  const penBtn = page.getByTitle("Toggle annotation mode (P)");
  const highlightBtn = page.getByTitle("Toggle highlighter (H)");

  // /highlight yellow activates the highlighter (not pen) with yellow selected.
  await page.keyboard.press("/");
  await page.keyboard.type("highlight yellow");
  await page.keyboard.press("Enter");
  await expect(highlightBtn).toHaveAttribute("aria-pressed", "true");
  await expect(penBtn).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTitle("Yellow")).toHaveAttribute("aria-pressed", "true");
  // Wait for the highlighter contract (freedraw, width 2*4, opacity 50) to be live.
  await expect(view).toHaveAttribute("data-canvas-ink-state", "freedraw:8:50");

  // Drawing commits a translucent stroke at 4x the default width (2 -> 8).
  await page.mouse.move(350, 250);
  await page.mouse.down();
  await page.mouse.move(450, 350);
  await page.mouse.up();
  await expect(view).toHaveAttribute("data-ink-count", /^[1-9]/);
  await expect(view).toHaveAttribute("data-translucent-ink-count", /^[1-9]/);
  await expect(view).toHaveAttribute("data-last-ink-stroke-width", "8");
  const translucentCount = (await view.getAttribute("data-translucent-ink-count"))!;

  // P switches to pen without leaving ink mode; the next stroke is opaque.
  await page.keyboard.press("p");
  await expect(penBtn).toHaveAttribute("aria-pressed", "true");
  await expect(highlightBtn).toHaveAttribute("aria-pressed", "false");
  await expect(view).toHaveAttribute("data-canvas-ink-state", "freedraw:2:100");
  await page.mouse.move(350, 420);
  await page.mouse.down();
  await page.mouse.move(450, 480);
  await page.mouse.up();
  await expect
    .poll(async () => Number(await view.getAttribute("data-ink-count")))
    .toBeGreaterThan(Number(translucentCount));
  await expect(view).toHaveAttribute("data-translucent-ink-count", translucentCount);
  await expect(view).toHaveAttribute("data-last-ink-stroke-width", "2");

  // H switches back to the highlighter, then toggles ink mode off.
  await page.keyboard.press("h");
  await expect(highlightBtn).toHaveAttribute("aria-pressed", "true");
  await expect(penBtn).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("h");
  await expect(highlightBtn).toHaveAttribute("aria-pressed", "false");
  await expect(penBtn).toHaveAttribute("aria-pressed", "false");
});

test("slide overview: G opens grid, click jumps, /goto navigates", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Add slide" }).click();
  await page.getByRole("button", { name: "Add slide" }).click();
  await expect(page.getByTestId("slide-title").nth(2)).toHaveValue("Slide 3");
  await page.getByRole("button", { name: "Present", exact: true }).click();
  // Adding a slide selects it, so the presentation starts on slide 3.
  await expect(page.getByText("3 / 3")).toBeVisible();

  const overview = page.getByTestId("slide-overview");

  // G opens the overview with one card per slide.
  await page.keyboard.press("g");
  await expect(overview).toBeVisible();
  await expect(page.getByTestId("overview-slide")).toHaveCount(3);

  // Escape closes the overview but stays in presentation mode.
  await page.keyboard.press("Escape");
  await expect(overview).not.toBeVisible();
  await expect(page.getByTestId("presentation-view")).toBeVisible();

  // Clicking a thumbnail jumps to that slide and closes the grid.
  await page.keyboard.press("g");
  await page.getByTestId("overview-slide").first().click();
  await expect(overview).not.toBeVisible();
  await expect(page.getByText("1 / 3")).toBeVisible();

  // /goto 2 jumps directly to the second slide.
  await page.keyboard.press("/");
  await page.keyboard.type("goto 2");
  await page.keyboard.press("Enter");
  await expect(page.getByText("2 / 3")).toBeVisible();
  // Regression: showNavBriefly must fire despite the just-closed command bar,
  // so navigation stays visible past the 500 ms fade that would follow a stale hide.
  await page.waitForTimeout(700);
  await expect(page.getByText("2 / 3")).toBeVisible();

  // Bare /goto opens the overview with focus trapped on the current slide.
  await page.keyboard.press("/");
  await page.keyboard.type("goto");
  await page.keyboard.press("Enter");
  await expect(overview).toBeVisible();
  const cards = page.getByTestId("overview-slide");
  await expect(cards.nth(1)).toBeFocused(); // current slide (2) is focused on open
  await page.keyboard.press("Shift+Tab");
  await expect(cards.first()).toBeFocused();
  await page.keyboard.press("Shift+Tab"); // wraps backward to the last card
  await expect(cards.nth(2)).toBeFocused();
  await page.keyboard.press("Tab"); // wraps forward to the first card
  await expect(cards.first()).toBeFocused();

  // G closes it again.
  await page.keyboard.press("g");
  await expect(overview).not.toBeVisible();
});

test("command bar: invalid command shows error and keeps bar open", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 1")).toBeVisible();

  await page.keyboard.press("/");
  await page.keyboard.type("frobnicate");
  await page.keyboard.press("Enter");

  // Bar stays open.
  await expect(page.getByTestId("command-bar-input")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Unknown command");

  // Typing clears the error.
  await page.keyboard.type("x");
  await expect(page.getByTestId("command-bar-error")).not.toBeVisible();

  // Escape closes.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-bar-input")).not.toBeVisible();
});

// Default Playwright viewport is 1280×720.
// Top zone: clientY <= 100  →  use y=60 (zone), y=90 (picker row inside zone), y=400 (out).
// Bottom zone: clientY >= 640  →  use y=670 (in zone).

test("edge-reveal: controls visible on orientation then hide", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();

  const topControls = page.getByTestId("presentation-top-controls");
  const navControls = page.getByTestId("presentation-nav-controls");

  // Both groups immediately visible during the 2-second orientation flash.
  await expect(topControls).toBeVisible();
  await expect(navControls).toBeVisible();

  // After 2 000ms orientation + 500ms fade-out transition + buffer.
  await page.waitForTimeout(2700);
  await expect(topControls).toBeHidden();
  await expect(navControls).toBeHidden();
});

test("edge-reveal: top zone dwell reveals toolbar and picker row stays in zone", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();

  const topControls = page.getByTestId("presentation-top-controls");

  // Wait for orientation to expire.
  await page.waitForTimeout(2700);
  await expect(topControls).toBeHidden();

  // Dwell in top zone: controls should appear after 200ms.
  await page.mouse.move(200, 60);
  await page.waitForTimeout(300);
  await expect(topControls).toBeVisible();

  // Picker row sits at ~y=56–92. Moving to y=90 is still within the 100px zone so the
  // 1 500ms hide timer must not fire.
  await page.mouse.move(200, 90);
  await page.waitForTimeout(1800); // would hide if zone were only 80px
  await expect(topControls).toBeVisible();
});

test("edge-reveal: opening command bar hides both control groups immediately", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();

  const topControls = page.getByTestId("presentation-top-controls");
  const navControls = page.getByTestId("presentation-nav-controls");

  // Both groups visible during orientation.
  await expect(topControls).toBeVisible();
  await expect(navControls).toBeVisible();

  // Opening the command bar must hide both groups synchronously.
  await page.keyboard.press("/");
  await expect(page.getByTestId("command-bar-input")).toBeVisible();
  await expect(topControls).toBeHidden();
  await expect(navControls).toBeHidden();

  // Closing the bar does not auto-reveal; zone pointer events must re-trigger them.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-bar-input")).not.toBeVisible();
  await expect(topControls).toBeHidden();
  await expect(navControls).toBeHidden();
});

test("edge-reveal: arrow key briefly reveals nav counter without showing top toolbar", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();

  const topControls = page.getByTestId("presentation-top-controls");
  const navControls = page.getByTestId("presentation-nav-controls");

  // Wait for orientation to expire.
  await page.waitForTimeout(2700);
  await expect(navControls).toBeHidden();
  await expect(topControls).toBeHidden();

  // Arrow key reveals only the navigation counter.
  await page.keyboard.press("ArrowRight");
  await expect(navControls).toBeVisible();
  await expect(topControls).toBeHidden();
});

test("edge-reveal: bottom zone dwell reveals navigation", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();

  const navControls = page.getByTestId("presentation-nav-controls");

  // Wait for orientation to expire.
  await page.waitForTimeout(2700);
  await expect(navControls).toBeHidden();

  // Dwell in bottom zone (y=670 is 50px from the bottom of a 720px viewport).
  await page.mouse.move(640, 670);
  await page.waitForTimeout(300);
  await expect(navControls).toBeVisible();
});

test("edge-reveal: keyboard timer keeps navigation pinned in bottom zone", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();

  const navControls = page.getByTestId("presentation-nav-controls");

  await page.waitForTimeout(2700);
  await expect(navControls).toBeHidden();

  await page.mouse.move(640, 670);
  await page.waitForTimeout(300);
  await expect(navControls).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(2100);
  await expect(navControls).toBeVisible();
});

test("edge-reveal: orientation timer does not hide toolbar when pointer is already in top zone", async ({ page }) => {
  await createAndOpenPresentation(page);
  await page.getByRole("button", { name: "Present", exact: true }).click();

  const topControls = page.getByTestId("presentation-top-controls");
  const navControls = page.getByTestId("presentation-nav-controls");

  // Park pointer in the top zone before the orientation timer fires.
  await page.mouse.move(200, 60);

  // Let the 2 000ms orientation timer fire and its fade-out transition complete.
  await page.waitForTimeout(2700);

  // Toolbar must remain pinned since the pointer is in the top zone.
  await expect(topControls).toBeVisible();
  // Nav is not in the bottom zone, so it should have been hidden normally.
  await expect(navControls).toBeHidden();
});
