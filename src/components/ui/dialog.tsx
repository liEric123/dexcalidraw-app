import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../lib/utils";

// A shadcn-style Dialog: Radix's accessible primitive (focus trap, Escape,
// outside-click, aria wiring) restyled with this app's existing Tailwind
// classes instead of shadcn's default CSS-variable theme, so it drops into
// the current stone/indigo look with no new global design tokens.

const Dialog = DialogPrimitive.Root;

function DialogContent({
  className,
  overlayClassName,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { overlayClassName?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn("fixed inset-0 z-50 bg-black/40", overlayClassName)} />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-[#fdf8f4] border border-stone-200 rounded-lg shadow-xl shadow-stone-300/40 p-5 w-80 max-w-[calc(100vw-2rem)] outline-none",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title className={cn("text-sm font-semibold text-stone-800", className)} {...props} />
  );
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-xs text-stone-500", className)} {...props} />;
}

export { Dialog, DialogContent, DialogTitle, DialogDescription };
