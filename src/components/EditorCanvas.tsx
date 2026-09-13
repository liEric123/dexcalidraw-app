import { useCallback } from "react";
import type { Slide, ExcalidrawData, VideoBlock, FrameBounds } from "../types/presentation";
import type { ExcalidrawImperativeAPI, LibraryItems } from "@excalidraw/excalidraw/types";
import ExcalidrawSlideCanvas from "./ExcalidrawSlideCanvas";
import VideoOverlayLayer from "./VideoOverlayLayer";
import EmptyState from "./EmptyState";

type Props = {
  slide: Slide | undefined;
  selectedVideoId: string | null;
  onExcalidrawChange: (slideId: string, data: ExcalidrawData) => void;
  onFrameChange: (slideId: string, bounds: FrameBounds) => void;
  onSelectVideo: (id: string) => void;
  onUpdateVideo: (id: string, patch: Partial<VideoBlock>) => void;
  onDeleteVideo: (id: string) => void;
  onFillVideo: (id: string) => void;
  isAddingVideo?: boolean;
  onDeselectVideo: () => void;
  libraryItems?: LibraryItems;
  onLibraryChange?: (items: LibraryItems) => void;
  onApiReady?: (api: ExcalidrawImperativeAPI) => void;
  onSelectionChange?: (ids: string[]) => void;
};

export default function EditorCanvas({
  slide,
  selectedVideoId,
  onExcalidrawChange,
  onFrameChange,
  onSelectVideo,
  onUpdateVideo,
  onDeleteVideo,
  onFillVideo,
  isAddingVideo,
  onDeselectVideo,
  libraryItems,
  onLibraryChange,
  onApiReady,
  onSelectionChange,
}: Props) {
  const slideId = slide?.id;
  const handleExcalidrawChange = useCallback(
    (data: ExcalidrawData) => {
      if (slideId) onExcalidrawChange(slideId, data);
    },
    [onExcalidrawChange, slideId]
  );

  const handleFrameChange = useCallback(
    (bounds: FrameBounds) => {
      if (slideId) onFrameChange(slideId, bounds);
    },
    [onFrameChange, slideId]
  );

  if (!slide) {
    return (
      <div className="flex-1 flex items-center justify-center bg-neutral-950 text-neutral-600 text-sm">
        No slide selected
      </div>
    );
  }

  const isEmpty =
    !slide.excalidrawData.elements.some((el) => !el.isDeleted) &&
    slide.videoBlocks.length === 0;

  return (
    <div className="flex-1 relative overflow-hidden" onClick={onDeselectVideo}>
      <ExcalidrawSlideCanvas
        key={slide.id}
        slide={slide}
        onChange={handleExcalidrawChange}
        onFrameChange={handleFrameChange}
        libraryItems={libraryItems}
        onLibraryChange={onLibraryChange}
        onApiReady={onApiReady}
        onSelectionChange={onSelectionChange}
      />
      <VideoOverlayLayer
        blocks={slide.videoBlocks}
        selectedVideoId={selectedVideoId}
        mode="editor"
        onSelectVideo={onSelectVideo}
        onUpdateVideo={onUpdateVideo}
        onDeleteVideo={onDeleteVideo}
        onFillVideo={onFillVideo}
        fillPending={isAddingVideo}
      />
      {isEmpty && <EmptyState />}
    </div>
  );
}
