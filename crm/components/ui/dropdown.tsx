"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
}

export function Dropdown({ trigger, children, align = "end", className }: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex">
        {trigger}
      </button>
      {open && (
        <div
          className={cn(
            "absolute z-40 mt-2 min-w-[12rem] rounded-xl border border-border bg-popover p-1 shadow-pop animate-fade-in",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm text-espresso-700 hover:bg-accent disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-border" />;
}
