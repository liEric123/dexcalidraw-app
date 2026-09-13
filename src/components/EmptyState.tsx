function Kbd({ children }: { children: string }) {
  return (
    <kbd className="text-stone-500 font-mono bg-stone-100 border border-stone-200 px-1 py-0.5 rounded text-[10px]">
      {children}
    </kbd>
  );
}

export default function EmptyState() {
  return (
    <div className="absolute inset-0 flex items-end justify-center pb-10 pointer-events-none select-none z-20">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <p className="text-stone-400 text-xs">
          Draw on the canvas or use Add Video to place a clip
        </p>
        <p className="text-stone-400 text-xs flex items-center gap-1.5">
          Press <Kbd>/</Kbd> for commands, <Kbd>?</Kbd> for help
        </p>
      </div>
    </div>
  );
}
