import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Editor video transport tests using a real, decodable 4-second WebM fixture
// (tests/fixtures/tiny.webm) so playback time genuinely advances.

const FIXTURE = "tests/fixtures/tiny.webm";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dexcalidraw" })).toBeVisible();
  await page.getByRole("button", { name: "New presentation" }).click();
  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeVisible();
});

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

async function readFirstVideoBlock(page: Page) {
  return readFirstStoredPresentation(page).then(
    (stored) => stored?.slides?.[0]?.videoBlocks?.[0]
  );
}

async function addFixtureVideo(page: Page) {
  await page
    .locator('input[accept="video/webm,video/mp4,video/quicktime"]')
    .first()
    .setInputFiles(FIXTURE);
  await expect(page.locator("video").first()).toHaveAttribute("src", /^blob:/);
}

// The <video> itself is pointer-events-none; clicking its wrapper selects the block.
async function selectVideo(page: Page) {
  await page.locator("video").first().locator("..").click({ position: { x: 30, y: 10 } });
  await expect(page.getByTestId("video-transport")).toBeVisible();
  // Transport enables once metadata is loaded.
  await expect.poll(() => videoState(page).then((s) => s.duration)).toBeGreaterThan(3);
}

async function videoState(page: Page) {
  return page.evaluate(() => {
    const video = document.querySelector("video")!;
    return {
      currentTime: video.currentTime,
      duration: video.duration,
      paused: video.paused,
      muted: video.muted,
    };
  });
}

// Press-drag-release on the scrubber at a fraction of its width.
async function scrubTo(page: Page, fraction: number) {
  const box = (await page.getByTestId("video-scrubber").boundingBox())!;
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

test("play advances time and pause freezes it", async ({ page }) => {
  await addFixtureVideo(page);
  await selectVideo(page);

  await page.getByTestId("video-play").click();
  await expect.poll(() => videoState(page).then((s) => s.currentTime)).toBeGreaterThan(0.2);
  expect((await videoState(page)).paused).toBe(false);

  await page.getByTestId("video-play").click(); // now a pause button
  await expect.poll(() => videoState(page).then((s) => s.paused)).toBe(true);
  const frozen = (await videoState(page)).currentTime;
  await page.waitForTimeout(400);
  expect((await videoState(page)).currentTime).toBe(frozen);
});

test("scrubbing seeks and resumes only when previously playing", async ({ page }) => {
  await addFixtureVideo(page);
  await selectVideo(page);

  // Scrub while paused: seeks, stays paused.
  await scrubTo(page, 0.5);
  await expect.poll(() => videoState(page).then((s) => s.currentTime)).toBeGreaterThan(1.5);
  expect((await videoState(page)).currentTime).toBeLessThan(2.5);
  expect((await videoState(page)).paused).toBe(true);

  // Scrub while playing: seeks, then resumes.
  await page.getByTestId("video-play").click();
  await expect.poll(() => videoState(page).then((s) => s.paused)).toBe(false);
  await scrubTo(page, 0.25);
  await expect.poll(() => videoState(page).then((s) => s.paused)).toBe(false);
  const t = (await videoState(page)).currentTime;
  expect(t).toBeGreaterThan(0.7);
  expect(t).toBeLessThan(2);
});

test("scrubber is a keyboard-operable slider", async ({ page }) => {
  await addFixtureVideo(page);
  await selectVideo(page);

  const scrubber = page.getByTestId("video-scrubber");
  await expect(scrubber).toHaveRole("slider");
  await scrubber.focus();

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => videoState(page).then((s) => s.currentTime)).toBeGreaterThan(1.9);

  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => videoState(page).then((s) => s.currentTime)).toBeLessThan(1.1);

  await page.keyboard.press("End");
  await expect.poll(() => videoState(page).then((s) => s.currentTime)).toBeGreaterThan(3.5);
  await page.keyboard.press("Home");
  await expect.poll(() => videoState(page).then((s) => s.currentTime)).toBe(0);
});

test("quick action sets trim start, shades the scrubber, and restart seeks to it", async ({ page }) => {
  await addFixtureVideo(page);
  await selectVideo(page);

  await scrubTo(page, 0.25); // ~1s
  await page.getByTestId("video-menu").click();
  await page.getByRole("menuitem", { name: "Set trim start here" }).click();

  await expect.poll(() => readFirstVideoBlock(page).then((b) => b?.trimStart ?? 0)).toBeGreaterThan(0.6);
  const trimStart: number = await readFirstVideoBlock(page).then((b) => b.trimStart);
  expect(trimStart).toBeLessThan(1.4);
  await expect(page.getByTestId("trim-shade-start")).toBeVisible();

  // Restart from elsewhere lands on trim start and plays.
  await scrubTo(page, 0.85);
  await page.getByTestId("video-restart").click();
  await expect.poll(() => videoState(page).then((s) => s.paused)).toBe(false);
  const t = (await videoState(page)).currentTime;
  expect(t).toBeGreaterThanOrEqual(trimStart - 0.05);
  expect(t).toBeLessThan(trimStart + 1);

  // Clear trim removes the shading and the stored fields.
  await page.getByTestId("video-menu").click();
  await page.getByRole("menuitem", { name: "Clear trim" }).click();
  await expect(page.getByTestId("trim-shade-start")).not.toBeVisible();
  await expect.poll(() => readFirstVideoBlock(page).then((b) => b?.trimStart ?? null)).toBe(null);
});

test("mute button updates the element and persisted metadata", async ({ page }) => {
  await addFixtureVideo(page);
  await selectVideo(page);
  expect((await videoState(page)).muted).toBe(false);

  await page.getByTestId("video-mute").click();
  await expect(page.getByTestId("video-mute")).toHaveAttribute("aria-pressed", "true");
  expect((await videoState(page)).muted).toBe(true);
  await expect.poll(() => readFirstVideoBlock(page).then((b) => b?.muted)).toBe(true);

  await page.getByTestId("video-mute").click();
  await expect(page.getByTestId("video-mute")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => readFirstVideoBlock(page).then((b) => b?.muted)).toBe(false);
});

test("breakpoints and trim end pause preview playback", async ({ page }) => {
  await addFixtureVideo(page);
  await selectVideo(page);

  // Breakpoint at ~1s, shown as a tick.
  await scrubTo(page, 0.25);
  await page.getByTestId("video-menu").click();
  await page.getByRole("menuitem", { name: "Add breakpoint here" }).click();
  await expect(page.getByTestId("breakpoint-tick")).toBeVisible();
  const breakpoint: number = await readFirstVideoBlock(page).then((b) => b.breakpoints[0]);
  expect(breakpoint).toBeGreaterThan(0.6);
  expect(breakpoint).toBeLessThan(1.4);

  // Restart from 0 → playback pauses at the breakpoint.
  await page.getByTestId("video-restart").click();
  await expect.poll(() => videoState(page).then((s) => s.paused), { timeout: 10_000 }).toBe(true);
  const pausedAt = (await videoState(page)).currentTime;
  expect(pausedAt).toBeGreaterThanOrEqual(breakpoint - 0.05);
  expect(pausedAt).toBeLessThan(breakpoint + 0.8);

  // Trim end at ~2s → resuming pauses there instead of playing to the end.
  await scrubTo(page, 0.5);
  await page.getByTestId("video-menu").click();
  await page.getByRole("menuitem", { name: "Set trim end here" }).click();
  const trimEnd: number = await readFirstVideoBlock(page).then((b) => b.trimEnd);
  expect(trimEnd).toBeGreaterThan(1.6);
  await expect(page.getByTestId("trim-shade-end")).toBeVisible();

  await scrubTo(page, 0.3); // between breakpoint and trim end
  await page.getByTestId("video-play").click();
  await expect.poll(() => videoState(page).then((s) => s.paused), { timeout: 10_000 }).toBe(true);
  const stoppedAt = (await videoState(page)).currentTime;
  expect(stoppedAt).toBeGreaterThanOrEqual(trimEnd - 0.05);
  expect(stoppedAt).toBeLessThan(trimEnd + 0.8);

  // Play at the trim-end boundary restarts from trim start (0 here) instead of
  // resuming beyond the boundary and re-pausing immediately.
  await page.getByTestId("video-play").click();
  await expect.poll(() => videoState(page).then((s) => s.paused)).toBe(false);
  expect((await videoState(page)).currentTime).toBeLessThan(trimEnd - 0.5);

  // On the way it pauses at the breakpoint again.
  await expect.poll(() => videoState(page).then((s) => s.paused), { timeout: 10_000 }).toBe(true);

  // Beyond the trim end the playhead cannot host a new breakpoint, and moving
  // trim start past trim end clears the now-inert trim end.
  await scrubTo(page, 0.9);
  await page.getByTestId("video-menu").click();
  await expect(page.getByRole("menuitem", { name: "Add breakpoint here" })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Set trim start here" }).click();
  await expect.poll(() => readFirstVideoBlock(page).then((b) => b.trimEnd ?? null)).toBe(null);
  await expect.poll(() => readFirstVideoBlock(page).then((b) => b.trimStart)).toBeGreaterThan(3);
});

test("deselecting the video pauses the preview", async ({ page }) => {
  await addFixtureVideo(page);
  await selectVideo(page);
  await page.getByTestId("video-play").click();
  await expect.poll(() => videoState(page).then((s) => s.paused)).toBe(false);

  // Click the canvas outside the block to deselect.
  await page.locator(".excalidraw").click({ position: { x: 30, y: 30 } });
  await expect(page.getByTestId("video-transport")).not.toBeVisible();
  await expect.poll(() => videoState(page).then((s) => s.paused)).toBe(true);
});

test("dragging and resizing still work around the transport", async ({ page }) => {
  await addFixtureVideo(page);
  await selectVideo(page);
  const before = await readFirstVideoBlock(page);

  // Drag from the upper part of the block (above the transport).
  const wrapper = page.locator("video").first().locator("..");
  const box = (await wrapper.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 12 + 30, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => readFirstVideoBlock(page).then((b) => b.x)).toBeGreaterThan(before.x);

  // Resize with the corner handle.
  const handle = page.locator('[data-resize="true"]');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 50, hb.y + hb.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => readFirstVideoBlock(page).then((b) => b.width)).toBeGreaterThan(before.width);

  // The transport itself never starts a drag.
  const afterResize = await readFirstVideoBlock(page);
  const transport = (await page.getByTestId("video-transport").boundingBox())!;
  await page.mouse.move(transport.x + 8, transport.y + transport.height - 6);
  await page.mouse.down();
  await page.mouse.move(transport.x + 80, transport.y - 40, { steps: 4 });
  await page.mouse.up();
  expect((await readFirstVideoBlock(page)).x).toBe(afterResize.x);
});

test("a reloaded Blob video is still playable", async ({ page, context }) => {
  await addFixtureVideo(page);
  await expect.poll(() => readFirstVideoBlock(page).then((b) => b?.src)).toBe("");

  // A fresh page (without this test's localStorage-clearing init script)
  // rehydrates the video from IndexedDB.
  const reopened = await context.newPage();
  await reopened.goto("/");
  await reopened.getByTestId("presentation-card").first().click();
  await expect(reopened.locator("video").first()).toHaveAttribute("src", /^blob:/);
  await selectVideo(reopened);
  await reopened.getByTestId("video-play").click();
  await expect.poll(() => videoState(reopened).then((s) => s.currentTime)).toBeGreaterThan(0.2);
  await reopened.close();
});

test("unsupported media shows a readable error instead of a transport", async ({ page }) => {
  await page
    .locator('input[accept="video/webm,video/mp4,video/quicktime"]')
    .first()
    .setInputFiles({
      name: "broken.webm",
      mimeType: "video/webm",
      buffer: Buffer.from("this is not a video"),
    });

  await expect(page.getByTestId("video-error")).toBeVisible();
  await expect(page.getByTestId("video-error")).toHaveText(/not supported|decoded|failed/);

  // Selecting it must not show playback controls for a broken source.
  await page.locator("video").first().locator("..").click({ position: { x: 30, y: 10 } });
  await expect(page.getByTestId("video-transport")).not.toBeVisible();
});

test("presentation shortcuts are unchanged: K toggles playback, R restarts from trim start", async ({ page }) => {
  await addFixtureVideo(page);
  await selectVideo(page);

  // Trim start at ~1s via the quick action.
  await scrubTo(page, 0.25);
  await page.getByTestId("video-menu").click();
  await page.getByRole("menuitem", { name: "Set trim start here" }).click();
  const trimStart: number = await readFirstVideoBlock(page).then((b) => b.trimStart);

  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByTestId("presentation-view")).toBeVisible();
  const presentVideo = () =>
    page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>("[data-testid='presentation-view'] video")!;
      return { currentTime: video.currentTime, paused: video.paused };
    });

  // Autoplay stays off in the deck; the video sits paused at trim start.
  expect((await presentVideo()).paused).toBe(true);

  await page.keyboard.press("k");
  await expect.poll(() => presentVideo().then((s) => s.paused)).toBe(false);
  await page.keyboard.press("k");
  await expect.poll(() => presentVideo().then((s) => s.paused)).toBe(true);

  await page.keyboard.press("r");
  await expect.poll(() => presentVideo().then((s) => s.paused)).toBe(false);
  const t = (await presentVideo()).currentTime;
  expect(t).toBeGreaterThanOrEqual(trimStart - 0.05);
  expect(t).toBeLessThan(trimStart + 1);

  // Let it run out; K at the media end resumes from trim start.
  await expect.poll(() => presentVideo().then((s) => s.paused), { timeout: 10_000 }).toBe(true);
  await page.keyboard.press("k");
  await expect.poll(() => presentVideo().then((s) => s.paused)).toBe(false);
  const resumed = (await presentVideo()).currentTime;
  expect(resumed).toBeGreaterThanOrEqual(trimStart - 0.05);
  expect(resumed).toBeLessThan(trimStart + 1.2);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeVisible();
});
