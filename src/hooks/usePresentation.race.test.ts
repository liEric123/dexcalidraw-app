// @vitest-environment jsdom
//
// Deterministic interleaving tests for usePresentation's async video
// workflows. videoStorage is mocked with per-call deferred promises so a
// "slow" IndexedDB write can be held open while the user acts, reproducing
// the races exactly:
//   - hydration migration must not clobber a video filled or deleted mid-flight
//   - fills must land on their block even if the current slide changed
//   - adds must land on (or roll back with) their captured target slide
//   - slide duplication must roll back if the source slide disappeared
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  saveVideoBlob: vi.fn<(id: string, blob: Blob) => Promise<void>>(async () => {}),
  loadVideoBlobs: vi.fn<(ids: string[]) => Promise<Map<string, Blob>>>(async () => new Map()),
  copyVideoBlob: vi.fn<(sourceId: string, targetId: string) => Promise<Blob | null>>(async () => null),
  deleteVideo: vi.fn<(id: string) => Promise<void>>(async () => {}),
}));
vi.mock("../lib/videoStorage", () => mocks);

import { usePresentation } from "./usePresentation";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const LEGACY_SRC = "data:video/webm;base64,AAAA";

function seedDeck({
  blocksOnSlide1 = [] as { id: string; src: string }[],
  extraSlide = false,
} = {}): string {
  const deckId = "race-deck";
  const slides: unknown[] = [
    {
      id: "s1",
      title: "Slide 1",
      excalidrawData: { elements: [], appState: {}, files: {} },
      videoBlocks: blocksOnSlide1.map(({ id, src }) => ({ id, name: id, src })),
      notes: "",
    },
  ];
  if (extraSlide) {
    slides.push({
      id: "s2",
      title: "Slide 2",
      excalidrawData: { elements: [], appState: {}, files: {} },
      videoBlocks: [],
      notes: "",
    });
  }
  localStorage.setItem(
    `excalidraw-video-deck:p:${deckId}`,
    JSON.stringify({
      id: deckId,
      title: "Race deck",
      slides,
      currentSlideId: "s1",
      createdAt: 1,
      updatedAt: 1,
    })
  );
  return deckId;
}

let urlCounter = 0;
const createObjectURL = vi.fn(() => `blob:mock/${++urlCounter}`);
const revokeObjectURL = vi.fn();
URL.createObjectURL = createObjectURL;
URL.revokeObjectURL = revokeObjectURL;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.saveVideoBlob.mockImplementation(async () => {});
  mocks.loadVideoBlobs.mockImplementation(async () => new Map());
  mocks.copyVideoBlob.mockImplementation(async () => null);
  mocks.deleteVideo.mockImplementation(async () => {});
});

function makeFile(name = "new.webm"): File {
  return new File(["user-picked-bytes"], name, { type: "video/webm" });
}

function savesFor(id: string) {
  return mocks.saveVideoBlob.mock.calls.filter(([savedId]) => savedId === id);
}

describe("hydration vs concurrent user mutations", () => {
  it("does not overwrite a video the user filled while a legacy migration was in flight", async () => {
    // Two legacy blocks. Hydration migrates A first (held open); the user
    // fills B meanwhile. Hydration must then skip B entirely.
    const deckId = seedDeck({
      blocksOnSlide1: [
        { id: "A", src: LEGACY_SRC },
        { id: "B", src: LEGACY_SRC },
      ],
    });
    const migrationOfA = deferred<void>();
    mocks.saveVideoBlob.mockImplementation((id) =>
      id === "A" ? migrationOfA.promise : Promise.resolve()
    );

    const { result } = renderHook(() => usePresentation(deckId));
    await waitFor(() =>
      expect(mocks.saveVideoBlob).toHaveBeenCalledWith("A", expect.anything())
    );

    const userFile = makeFile();
    await act(async () => {
      await result.current.setVideoBlockFile("B", userFile);
    });
    expect(savesFor("B")).toHaveLength(1);
    expect(savesFor("B")[0][1]).toBe(userFile);

    await act(async () => {
      migrationOfA.resolve();
    });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    // B was never re-saved with its stale legacy payload, and its src is the
    // URL created for the user's file.
    expect(savesFor("B")).toHaveLength(1);
    const blockB = result.current.presentation.slides[0].videoBlocks.find((b) => b.id === "B")!;
    expect(blockB.src).toMatch(/^blob:mock\//);
    expect(blockB.name).toBe("new.webm");
  });

  it("does not resurrect a record or mint an orphan URL for a video deleted during hydration", async () => {
    // A is legacy (migration held open); B has a stored blob. The user
    // deletes B while A's migration is pending: hydration must neither
    // re-save B nor create an object URL for it.
    const deckId = seedDeck({
      blocksOnSlide1: [
        { id: "A", src: LEGACY_SRC },
        { id: "B", src: "" },
      ],
    });
    const storedB = new Blob(["stored-b"], { type: "video/webm" });
    mocks.loadVideoBlobs.mockImplementation(async () => new Map([["B", storedB]]));
    const migrationOfA = deferred<void>();
    mocks.saveVideoBlob.mockImplementation((id) =>
      id === "A" ? migrationOfA.promise : Promise.resolve()
    );

    const { result } = renderHook(() => usePresentation(deckId));
    await waitFor(() =>
      expect(mocks.saveVideoBlob).toHaveBeenCalledWith("A", expect.anything())
    );

    await act(async () => {
      result.current.deleteVideoBlock("B");
    });
    expect(mocks.deleteVideo).toHaveBeenCalledWith("B");

    await act(async () => {
      migrationOfA.resolve();
    });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    // No write ever targeted B, and no URL was created for its stale blob.
    expect(savesFor("B")).toHaveLength(0);
    expect(createObjectURL).toHaveBeenCalledTimes(1); // A only
    expect(result.current.presentation.slides[0].videoBlocks.map((b) => b.id)).toEqual(["A"]);
  });
});

describe("async writes keep their original target", () => {
  it("updates the filled block by id even when the current slide changed during the write", async () => {
    const deckId = seedDeck({ blocksOnSlide1: [{ id: "X", src: "" }], extraSlide: true });
    const save = deferred<void>();
    mocks.saveVideoBlob.mockImplementation(() => save.promise);

    const { result } = renderHook(() => usePresentation(deckId));
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    let fillDone: Promise<void>;
    act(() => {
      fillDone = result.current.setVideoBlockFile("X", makeFile("filled.webm"));
    });
    await act(async () => {
      result.current.selectSlide("s2");
    });
    await act(async () => {
      save.resolve();
      await fillDone;
    });

    const blockX = result.current.presentation.slides[0].videoBlocks[0];
    expect(blockX.name).toBe("filled.webm");
    expect(blockX.src).toMatch(/^blob:mock\//);
  });

  it("adds the video to the slide that was current when the file was picked", async () => {
    const deckId = seedDeck({ extraSlide: true });
    const save = deferred<void>();
    mocks.saveVideoBlob.mockImplementation(() => save.promise);

    const { result } = renderHook(() => usePresentation(deckId));
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    let addDone: Promise<void>;
    act(() => {
      addDone = result.current.addVideoBlock(makeFile());
    });
    await act(async () => {
      result.current.selectSlide("s2");
    });
    await act(async () => {
      save.resolve();
      await addDone;
    });

    const [slide1, slide2] = result.current.presentation.slides;
    expect(slide1.videoBlocks).toHaveLength(1);
    expect(slide2.videoBlocks).toHaveLength(0);
  });

  it("rolls back an added video when its target slide was deleted during the write", async () => {
    const deckId = seedDeck({ extraSlide: true });
    const save = deferred<void>();
    mocks.saveVideoBlob.mockImplementation(() => save.promise);

    const { result } = renderHook(() => usePresentation(deckId));
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    let addDone: Promise<void>;
    act(() => {
      addDone = result.current.addVideoBlock(makeFile());
    });
    await act(async () => {
      result.current.deleteSlide("s1");
    });
    await act(async () => {
      save.resolve();
      await addDone;
    });

    const newId = mocks.saveVideoBlob.mock.calls[0][0];
    expect(mocks.deleteVideo).toHaveBeenCalledWith(newId);
    expect(result.current.presentation.slides.flatMap((s) => s.videoBlocks)).toHaveLength(0);
  });

  it("rolls back duplicated video records when the source slide was deleted mid-copy", async () => {
    const deckId = seedDeck({ blocksOnSlide1: [{ id: "A", src: "" }], extraSlide: true });
    const storedA = new Blob(["stored-a"], { type: "video/webm" });
    mocks.loadVideoBlobs.mockImplementation(async () => new Map([["A", storedA]]));
    const copy = deferred<Blob | null>();
    mocks.copyVideoBlob.mockImplementation(() => copy.promise);

    const { result } = renderHook(() => usePresentation(deckId));
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    let duplicateDone: Promise<void>;
    act(() => {
      duplicateDone = result.current.duplicateSlide("s1");
    });
    await act(async () => {
      result.current.deleteSlide("s1");
    });
    await act(async () => {
      copy.resolve(storedA);
      await duplicateDone;
    });

    const copiedId = mocks.copyVideoBlob.mock.calls[0][1];
    expect(mocks.deleteVideo).toHaveBeenCalledWith(copiedId);
    // Only slide 2 remains; no duplicate slide was inserted.
    expect(result.current.presentation.slides.map((s) => s.id)).toEqual(["s2"]);
  });
});
