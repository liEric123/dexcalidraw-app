import { useState, useRef, useCallback, useEffect } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { Slide, VideoBlock, ExcalidrawData } from "../types/presentation";
import RevealStepsPanel from "./RevealStepsPanel";

type Props = {
  slide: Slide | undefined;
  selectedVideo: VideoBlock | undefined;
  selectedElementIds: string[];
  onNotesChange: (notes: string) => void;
  onNotesDrawingChange: (data: ExcalidrawData) => void;
  onRevealStepsChange: (steps: string[][]) => void;
  onSelectElements: (ids: string[]) => void;
  onUpdateVideo: (patch: Partial<VideoBlock>) => void;
  onDeleteVideo: () => void;
};

export default function RightPanel({ slide, selectedVideo, selectedElementIds, onNotesChange, onNotesDrawingChange, onRevealStepsChange, onSelectElements, onUpdateVideo, onDeleteVideo }: Props) {
  const [notesTab, setNotesTab] = useState<"text" | "draw">("text");
  const [panelWidth, setPanelWidth] = useState(256);
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = panelWidth;
    e.preventDefault();
  }, [panelWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = startXRef.current - e.clientX;
      setPanelWidth(Math.max(200, Math.min(700, startWidthRef.current + delta)));
    };
    const onUp = () => { isResizingRef.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div style={{ width: panelWidth }} className="shrink-0 flex flex-col bg-[#fdf8f4] border-l border-stone-200 overflow-hidden relative">
      <div
        onMouseDown={handleResizeStart}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-400/30 active:bg-indigo-400/50 transition-colors z-10"
        title="Drag to resize"
      />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {!slide ? null : selectedVideo ? (
          <VideoSettings
            key={selectedVideo.id}
            video={selectedVideo}
            onUpdate={onUpdateVideo}
            onDelete={onDeleteVideo}
          />
        ) : (
          <>
            <div className="px-3 py-2 border-b border-stone-100 shrink-0 flex items-center gap-0.5">
              <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest mr-2">Notes</span>
              {(["text", "draw"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setNotesTab(tab)}
                  className={`text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded transition-colors ${
                    notesTab === tab
                      ? "text-stone-800 bg-stone-200"
                      : "text-stone-400 hover:text-stone-600"
                  }`}
                >
                  {tab === "text" ? "Text" : "Draw"}
                </button>
              ))}
            </div>
            {notesTab === "text" ? (
              <textarea
                className="flex-1 bg-transparent text-sm text-stone-700 placeholder-stone-300 p-3 outline-none resize-none leading-relaxed"
                placeholder="Speaker notes…"
                value={slide.notes}
                onChange={(e) => onNotesChange(e.target.value)}
                spellCheck
              />
            ) : (
              <div className="flex-1 min-h-0">
                <NotesDrawingCanvas
                  key={slide.id}
                  initialData={slide.notesDrawing}
                  onChange={onNotesDrawingChange}
                />
              </div>
            )}
            <RevealStepsPanel
              slide={slide}
              selectedElementIds={selectedElementIds}
              onChange={onRevealStepsChange}
              onSelectElements={onSelectElements}
            />
          </>
        )}
      </div>
    </div>
  );
}

function NotesDrawingCanvas({
  initialData,
  onChange,
}: {
  initialData: ExcalidrawData | undefined;
  onChange: (data: ExcalidrawData) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[], _appState: AppState, files: BinaryFiles) => {
      const visibleElements = elements.filter((el) => !el.isDeleted);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onChange({ elements: visibleElements, appState: {}, files });
      }, 200);
    },
    [onChange]
  );

  return (
    <div className="w-full h-full">
      <Excalidraw
        initialData={{
          elements: initialData?.elements ?? [],
          appState: { viewBackgroundColor: "#faf9f7" },
          files: initialData?.files ?? {},
          scrollToContent: (initialData?.elements?.length ?? 0) > 0,
        }}
        onChange={handleChange}
        theme="light"
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: false,
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: false,
            saveAsImage: false,
          },
        }}
      />
    </div>
  );
}

const NUM_INPUT = "bg-stone-50 text-sm text-stone-800 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-indigo-400/50 w-full border border-stone-200 transition-shadow";

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1 flex-1">
      <span className="text-xs text-stone-400">{label}</span>
      <input
        type="number"
        className={NUM_INPUT}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function VideoSettings({
  video,
  onUpdate,
  onDelete,
}: {
  video: VideoBlock;
  onUpdate: (patch: Partial<VideoBlock>) => void;
  onDelete: () => void;
}) {
  const [locked, setLocked] = useState(false);

  const handleWidth = (pct: number) => {
    const w = Math.max(0.05, pct / 100);
    const patch: Partial<VideoBlock> = { width: w };
    if (locked) patch.height = Math.max(0.05, w * (video.height / video.width));
    onUpdate(patch);
  };

  const handleHeight = (pct: number) => {
    const h = Math.max(0.05, pct / 100);
    const patch: Partial<VideoBlock> = { height: h };
    if (locked) patch.width = Math.max(0.05, h * (video.width / video.height));
    onUpdate(patch);
  };

  const handleReset = () => onUpdate({ width: 0.4, height: 0.35 });

  return (
    <div className="flex flex-col gap-3.5 p-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest">Video</span>
        <button
          onClick={() => { if (window.confirm("Delete this video?")) onDelete(); }}
          className="text-xs text-stone-400 hover:text-red-500 transition-colors"
        >
          Delete
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-stone-500">Name</label>
        <input
          className={NUM_INPUT}
          value={video.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          spellCheck={false}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-stone-500">Position (%)</label>
        <div className="flex gap-2">
          <NumField label="X" value={Math.round(video.x * 100)} onChange={(v) => onUpdate({ x: Math.max(0, Math.min(100, v)) / 100 })} />
          <NumField label="Y" value={Math.round(video.y * 100)} onChange={(v) => onUpdate({ y: Math.max(0, Math.min(100, v)) / 100 })} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-stone-500">Size (%)</label>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 cursor-pointer text-xs text-stone-400">
              <input
                type="checkbox"
                checked={locked}
                onChange={(e) => setLocked(e.target.checked)}
                className="accent-indigo-600"
              />
              lock ratio
            </label>
            <button
              onClick={handleReset}
              className="text-xs text-stone-400 hover:text-stone-700 transition-colors"
              title="Reset to default size"
            >
              reset
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <NumField label="W" value={Math.round(video.width * 100)} onChange={handleWidth} />
          <NumField label="H" value={Math.round(video.height * 100)} onChange={handleHeight} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-stone-500">Fit</label>
        <div className="flex rounded-lg overflow-hidden gap-px bg-stone-100 border border-stone-200">
          {(["contain", "cover"] as const).map((fit) => (
            <button
              key={fit}
              onClick={() => onUpdate({ objectFit: fit })}
              className={`flex-1 text-xs py-1.5 capitalize transition-colors ${
                video.objectFit === fit
                  ? "bg-indigo-600 text-white"
                  : "bg-stone-100 text-stone-500 hover:text-stone-800 hover:bg-stone-200"
              }`}
            >
              {fit}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-stone-500">Breakpoints (s) — press V to advance</label>
        <input
          type="text"
          className={NUM_INPUT}
          placeholder="e.g. 2.5, 5, 8.3"
          value={(video.breakpoints ?? []).join(", ")}
          onChange={(e) => {
            const vals = e.target.value
              .split(",")
              .map(s => parseFloat(s.trim()))
              .filter(n => !isNaN(n) && n > 0)
              .sort((a, b) => a - b);
            onUpdate({ breakpoints: vals.length > 0 ? vals : undefined });
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-stone-500">Trim (s, 0 = off)</label>
        <div className="flex gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <span className="text-xs text-stone-400">Start</span>
            <input
              type="number"
              min={0}
              step={0.1}
              className={NUM_INPUT}
              value={video.trimStart ?? 0}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onUpdate({ trimStart: v > 0 ? v : undefined });
              }}
            />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <span className="text-xs text-stone-400">End</span>
            <input
              type="number"
              min={0}
              step={0.1}
              className={NUM_INPUT}
              value={video.trimEnd ?? 0}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onUpdate({ trimEnd: v > 0 ? v : undefined });
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs text-stone-500">Playback</label>
        {(["autoplay", "loop", "muted"] as const).map((key) => (
          <label key={key} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={video[key]}
              onChange={(e) => onUpdate({ [key]: e.target.checked })}
              className="accent-indigo-600"
            />
            <span className="text-sm text-stone-600 capitalize">{key}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
