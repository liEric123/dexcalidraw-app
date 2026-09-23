import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "../../lib/utils";

// A shadcn-style DropdownMenu: Radix's primitive (arrow-key navigation,
// type-ahead, Escape, outside-click, aria wiring) restyled with this app's
// existing Tailwind classes. Default styling matches TopBar's light menu;
// callers with a different theme (e.g. the dark canvas-overlay menu in
// VideoBlockView) override via className, merged with tailwind-merge.

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

function DropdownMenuContent({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[192px] py-1.5 rounded-xl border border-stone-200 bg-[#fdf8f4] shadow-xl shadow-stone-200/60 outline-none",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex items-center gap-2.5 w-full px-3.5 py-2 text-sm text-stone-500 outline-none cursor-pointer transition-colors hover:bg-stone-50 hover:text-stone-900 focus:bg-stone-50 focus:text-stone-900 data-[disabled]:opacity-40 data-[disabled]:pointer-events-none",
        className
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator className={cn("h-px bg-stone-100 my-1 mx-2", className)} {...props} />
  );
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator };
