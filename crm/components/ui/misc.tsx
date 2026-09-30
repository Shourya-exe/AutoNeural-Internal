import * as React from "react";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";

export function Separator({ className, orientation = "horizontal" }: { className?: string; orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      role="separator"
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
    />
  );
}

export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 select-none items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#8C1C2B] to-[#5E0D18] text-[11px] font-semibold text-white ring-1 ring-white/15",
        className,
      )}
      title={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        initials(name || "?")
      )}
    </span>
  );
}

export function EmptyState({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
      {icon && <div className="text-gold-700">{icon}</div>}
      <p className="text-sm font-medium text-espresso-700">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} />;
}

export function StatTile({
  label,
  value,
  sub,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "default" | "danger" | "success" | "gold";
  href?: string;
}) {
  const toneClass = {
    default: "text-espresso",
    danger: "text-danger-600",
    success: "text-emerald-600",
    gold: "text-gold-700",
  }[tone];
  const inner = (
    <div className="glass-edge lift rounded-2xl border border-border bg-card p-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums", toneClass)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
  return href ? (
    <a href={href} className="block">
      {inner}
    </a>
  ) : (
    inner
  );
}
