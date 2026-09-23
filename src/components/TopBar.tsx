import type { Presentation } from "../types/presentation";
import type { SaveStatus } from "../hooks/usePresentation";
import type { StorageEstimateResult, StorageLevel } from "../lib/storageHealth";
import StorageIndicator from "./StorageIndicator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";

type Props = {
  presentation: Presentation;
  saveStatus: SaveStatus;
  isHydrated: boolean;
  isExporting: boolean;
  isAddingVideo: boolean;
  storageEstimate: StorageEstimateResult | null;
  storageLevel: StorageLevel;
  slideBackgroundColor: string | undefined;
  onHome: () => void;
  onPresent: () => void;
  onTitleChange: (title: string) => void;
  onBackgroundColorChange: (color: string) => void;
  onAddVideo: () => void;
  onExport: () => void;
  onImport: () => void;
  onImportExcalidraw: () => void;
  onInsertMermaid: () => void;
  onImportLibrary: () => void;
  onClearLibrary: () => void;
  libraryItemCount: number;
  onToggleTemplate: () => void;
  onHelp: () => void;
};

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "",
};

function MoreMenu({
  isHydrated,
  isExporting,
  isTemplate,
  onExport,
  onImport,
  onImportExcalidraw,
  onInsertMermaid,
  canInsertMermaid,
  onImportLibrary,
  onClearLibrary,
  libraryItemCount,
  onToggleTemplate,
}: {
  isHydrated: boolean;
  isExporting: boolean;
  isTemplate: boolean;
  onExport: () => void;
  onImport: () => void;
  onImportExcalidraw: () => void;
  onInsertMermaid: () => void;
  canInsertMermaid: boolean;
  onImportLibrary: () => void;
  onClearLibrary: () => void;
  libraryItemCount: number;
  onToggleTemplate: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title="More options"
          aria-label="More options"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-700 hover:bg-stone-100 transition-colors data-[state=open]:bg-stone-100 data-[state=open]:text-stone-700"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="13" cy="8" r="1.5" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onExport} disabled={!isHydrated || isExporting}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 1v8M4 6l3 3 3-3M2 10v1.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V10" />
          </svg>
          Export backup
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImport}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 9V1M4 4l3-3 3 3M2 10v1.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V10" />
          </svg>
          Import backup
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onImportExcalidraw}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
            <path d="M4 7h6M7 4v6" />
          </svg>
          Import .excalidraw
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onInsertMermaid} disabled={!canInsertMermaid}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4.5" y="1" width="5" height="3.5" rx="0.75" />
            <rect x="1" y="9.5" width="5" height="3.5" rx="0.75" />
            <rect x="8" y="9.5" width="5" height="3.5" rx="0.75" />
            <path d="M7 4.5V7M7 7H3.5v2.5M7 7h3.5v2.5" />
          </svg>
          Insert Mermaid diagram…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onImportLibrary}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2.5h10M2 5.5h10M2 8.5h6" />
            <circle cx="10.5" cy="10" r="2" />
            <path d="M10.5 9v2M9.5 10h2" />
          </svg>
          Install library (.excalidrawlib)
        </DropdownMenuItem>
        {libraryItemCount > 0 && (
          <DropdownMenuItem onClick={onClearLibrary} className="text-red-400 hover:text-red-600 focus:text-red-600">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 2.5h10M2 5.5h10M2 8.5h5" />
              <path d="M9 9l3 3M12 9l-3 3" />
            </svg>
            Clear library ({libraryItemCount} items)
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onToggleTemplate}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 1.5l1.85 3.75 4.15.6-3 2.93.7 4.12L7 11.05l-3.7 1.85.7-4.12-3-2.93 4.15-.6L7 1.5z" />
          </svg>
          {isTemplate ? "Remove from templates" : "Save as template"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function TopBar({
  presentation,
  saveStatus,
  isHydrated,
  isExporting,
  isAddingVideo,
  storageEstimate,
  storageLevel,
  slideBackgroundColor,
  onHome,
  onPresent,
  onTitleChange,
  onBackgroundColorChange,
  onAddVideo,
  onExport,
  onImport,
  onImportExcalidraw,
  onInsertMermaid,
  onImportLibrary,
  onClearLibrary,
  libraryItemCount,
  onToggleTemplate,
  onHelp,
}: Props) {
  const hasSlides = presentation.slides.length > 0;

  return (
    <div className="flex items-center gap-2 px-3 h-12 bg-[#fdf8f4] border-b border-stone-200 shadow-sm shadow-stone-100/50 shrink-0">
      <button
        onClick={onHome}
        title="All presentations"
        aria-label="Back to home"
        className="flex items-center gap-1.5 text-stone-400 hover:text-stone-700 shrink-0 transition-colors px-1.5 py-1 rounded-lg hover:bg-stone-100"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.5 2.5L4 7l4.5 4.5" />
        </svg>
      </button>

      <div className="w-px h-4 bg-stone-200 shrink-0" />

      <input
        className="bg-transparent text-stone-900 text-sm font-medium outline-none focus:text-stone-950 w-52 truncate shrink-0 px-1 rounded-md"
        value={presentation.title}
        onChange={(e) => onTitleChange(e.target.value)}
        spellCheck={false}
      />

      {presentation.isTemplate && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-indigo-500 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
          Template
        </span>
      )}

      <span
        className={`flex-1 text-xs text-stone-400 transition-opacity duration-300 ${
          saveStatus === "saving" || saveStatus === "saved" ? "opacity-100" : "opacity-0"
        }`}
      >
        {STATUS_LABEL[saveStatus]}
      </span>

      <div className="flex items-center gap-1.5 shrink-0">
        <StorageIndicator estimate={storageEstimate} level={storageLevel} />

        {slideBackgroundColor !== undefined && (
          <label title="Slide background color" className="cursor-pointer flex items-center">
            <div
              className="w-5 h-5 rounded border border-stone-300 shadow-inner"
              style={{ background: slideBackgroundColor }}
            />
            <input
              type="color"
              value={slideBackgroundColor}
              onChange={(e) => onBackgroundColorChange(e.target.value)}
              className="sr-only"
              style={{ colorScheme: "light" }}
            />
          </label>
        )}

        <MoreMenu
          isHydrated={isHydrated}
          isExporting={isExporting}
          isTemplate={presentation.isTemplate ?? false}
          onExport={onExport}
          onImport={onImport}
          onImportExcalidraw={onImportExcalidraw}
          onInsertMermaid={onInsertMermaid}
          canInsertMermaid={hasSlides}
          onImportLibrary={onImportLibrary}
          onClearLibrary={onClearLibrary}
          libraryItemCount={libraryItemCount}
          onToggleTemplate={onToggleTemplate}
        />

        <button
          onClick={onAddVideo}
          disabled={!hasSlides || isAddingVideo}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-stone-100 hover:bg-stone-200 text-stone-600 hover:text-stone-900 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none border border-stone-200"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="0.75" y="2.75" width="8" height="7.5" rx="1" />
            <path d="M9.75 5l2.5-1.5v6L9.75 8" />
          </svg>
          {isAddingVideo ? "Adding video…" : "Add Video"}
        </button>

        <button
          onClick={onPresent}
          disabled={!hasSlides}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none font-medium shadow-sm shadow-indigo-200"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
            <path d="M2 1.5l7 4-7 4V1.5z" />
          </svg>
          Present
        </button>

        <button
          onClick={onHelp}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          className="w-7 h-7 flex items-center justify-center text-xs text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors font-medium"
        >
          ?
        </button>
      </div>
    </div>
  );
}
