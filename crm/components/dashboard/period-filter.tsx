"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { PERIOD_OPTIONS } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export function PeriodFilter({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string) {
    const next = new URLSearchParams(params);
    next.set("period", key);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="inline-flex rounded-md border border-border bg-surface p-0.5 shadow-sm">
      {PERIOD_OPTIONS.map((o) => (
        <button
          key={o.key}
          onClick={() => set(o.key)}
          className={cn(
            "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors",
            current === o.key
              ? "bg-champagne-200 text-espresso"
              : "text-espresso-500 hover:text-espresso-700",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
