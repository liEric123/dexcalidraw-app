import { useState } from "react";
import type { Presentation, Slide } from "../types/presentation";
import SlideThumbnail from "./SlideThumbnail";

type Props = {
  presentation: Presentation;
  onSelectSlide: (id: string) => void;
  onAddSlide: () => void;
  onDuplicateSlide: (id: string) => void;
  onDeleteSlide: (id: string) => void;
  onRenameSlide: (id: string, title: string) => void;
  onMoveSlide: (id: string, direction: "up" | "down") => void;
  onReorderSlide: (id: string, toIndex: number) => void;
};

export default function SlideSidebar({
  presentation,
  onSelectSlide,
  onAddSlide,
  onDuplicateSlide,
  onDeleteSlide,
  onRenameSlide,
  onMoveSlide,
  onReorderSlide,
}: Props) {
  const { slides, currentSlideId } = presentation;
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);

  const draggedIndex = draggedId ? slides.findIndex((s) => s.id === draggedId) : -1;
  const showLine = (pos: number) =>
    insertAt === pos && draggedId !== null && pos !== draggedIndex && pos !== draggedIndex + 1;

  return (
    <div className="flex flex-col h-full bg-[#fdf8f4] border-r border-stone-200 w-56 shrink-0">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-stone-100">
        <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest">Slides</span>
        <button
          onClick={onAddSlide}
          title="Add slide"
          aria-label="Add slide"
          className="flex items-center gap-1 text-xs px-2 py-1 bg-stone-100 hover:bg-stone-200 text-stone-500 hover:text-stone-900 rounded-lg transition-colors border border-stone-200"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M5 1v8M1 5h8" />
          </svg>
          Slide
        </button>
      </div>
      <div
        className="flex-1 overflow-y-auto py-2 px-2 flex flex-col gap-1.5"
        onDrop={(e) => {
          e.preventDefault();
          if (draggedId !== null && insertAt !== null) onReorderSlide(draggedId, insertAt);
          setDraggedId(null);
          setInsertAt(null);
        }}
      >
        {slides.map((slide, index) => (
          <div
            key={slide.id}
            onDragOver={(e) => {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              setInsertAt(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
            }}
          >
            {showLine(index) && <div className="h-0.5 bg-indigo-400 rounded mb-1.5" />}
            <SlideItem
              slide={slide}
              index={index}
              isSelected={slide.id === currentSlideId}
              isFirst={index === 0}
              isLast={index === slides.length - 1}
              isDragging={draggedId === slide.id}
              onSelect={() => onSelectSlide(slide.id)}
              onDuplicate={() => onDuplicateSlide(slide.id)}
              onDelete={() => onDeleteSlide(slide.id)}
              onRename={(title) => onRenameSlide(slide.id, title)}
              onMoveUp={() => onMoveSlide(slide.id, "up")}
              onMoveDown={() => onMoveSlide(slide.id, "down")}
              onDragStart={() => setDraggedId(slide.id)}
              onDragEnd={() => { setDraggedId(null); setInsertAt(null); }}
            />
          </div>
        ))}
        {showLine(slides.length) && <div className="h-0.5 bg-indigo-400 rounded" />}
      </div>
    </div>
  );
}

type SlideItemProps = {
  slide: Slide;
  index: number;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
  isDragging: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};

function SlideItem({
  slide,
  index,
  isSelected,
  isFirst,
  isLast,
  isDragging,
  onSelect,
  onDuplicate,
  onDelete,
  onRename,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnd,
}: SlideItemProps) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={`group rounded-lg overflow-hidden cursor-grab active:cursor-grabbing select-none border transition-all duration-150 ${
        isDragging ? "opacity-40" : ""
      } ${
        isSelected
          ? "border-indigo-400 shadow-[0_0_0_2px_rgba(99,102,241,0.10),0_1px_4px_rgba(0,0,0,0.08)]"
          : "border-stone-200 hover:border-stone-300"
      }`}
    >
      <SlideThumbnail slide={slide} />
      <div className={`flex items-center gap-1.5 px-2 py-1.5 ${
        isSelected ? "bg-indigo-50" : "bg-stone-50"
      }`}>
        <span className="text-[11px] tabular-nums text-stone-400 w-4 shrink-0">{index + 1}</span>
        <input
          data-testid="slide-title"
          className={`flex-1 min-w-0 bg-transparent text-xs outline-none truncate cursor-pointer ${
            isSelected ? "text-stone-800" : "text-stone-400 group-hover:text-stone-700"
          }`}
          value={slide.title}
          onChange={(e) => onRename(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          spellCheck={false}
        />
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton onClick={(e) => { e.stopPropagation(); onMoveUp(); }} disabled={isFirst} title="Move up">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 6.5l3-3 3 3" />
            </svg>
          </IconButton>
          <IconButton onClick={(e) => { e.stopPropagation(); onMoveDown(); }} disabled={isLast} title="Move down">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3.5l3 3 3-3" />
            </svg>
          </IconButton>
          <IconButton onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Duplicate slide">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1" />
              <path d="M6.5 3.5V2A1 1 0 005.5 1H2A1 1 0 001 2v3.5A1 1 0 002 6.5h1.5" />
            </svg>
          </IconButton>
          <IconButton
            data-testid="delete-slide"
            onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this slide?")) onDelete(); }}
            title="Delete slide"
            danger
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M2 2l6 6M8 2L2 8" />
            </svg>
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
  danger,
  "data-testid": testId,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
  "data-testid"?: string;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-5 h-5 flex items-center justify-center rounded-md transition-colors disabled:opacity-25 ${
        danger
          ? "text-stone-400 hover:text-red-500 hover:bg-red-50"
          : "text-stone-400 hover:text-stone-700 hover:bg-stone-100"
      }`}
    >
      {children}
    </button>
  );
}
