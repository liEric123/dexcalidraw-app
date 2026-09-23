type Props = {
  onPickFile: () => void;
  onDismiss: () => void;
};

export default function SaveErrorToast({ onPickFile, onDismiss }: Props) {
  return (
    <div
      role="alert"
      className="fixed bottom-5 right-5 z-50 w-72 bg-[#fdf8f4] border border-stone-200 rounded-xl shadow-xl shadow-stone-200/60 overflow-hidden"
    >
      <div className="h-0.5 bg-red-500" />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <p className="text-sm font-medium text-stone-900">Video too large</p>
          <button
            onClick={onDismiss}
            aria-label="Dismiss error"
            className="w-5 h-5 flex items-center justify-center rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors shrink-0"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M2 2l6 6M8 2L2 8" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-stone-500 mb-3">
          Browser storage limit reached. Try a compressed or shorter clip.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onPickFile}
            className="flex-1 text-xs py-1.5 px-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
          >
            Use smaller file
          </button>
          <button
            onClick={onDismiss}
            className="text-xs py-1.5 px-3 bg-stone-100 hover:bg-stone-200 text-stone-600 hover:text-stone-900 rounded-lg transition-colors border border-stone-200"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
