"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  // Portaled to <body>: glass cards use backdrop-filter, which (like transform) makes an
  // element the containing block for position:fixed descendants — without the portal a
  // dialog opened inside a card would be trapped within that card.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "glass-edge relative z-10 w-full max-w-lg rounded-2xl border border-border bg-popover p-6 shadow-pop animate-rise-in",
          className,
        )}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
        {title && <h2 className="text-base font-semibold text-espresso">{title}</h2>}
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        <div className={cn(title && "mt-4")}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
