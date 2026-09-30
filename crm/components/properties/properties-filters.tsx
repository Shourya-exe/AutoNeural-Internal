"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export function PropertiesFilters({
  cities,
}: {
  cities: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(sp);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page");
      router.push(`${pathname}?${next.toString()}`);
    },
    [sp, pathname, router],
  );

  const has = Array.from(sp.keys()).some((k) =>
    ["q", "type", "purpose", "status", "city"].includes(k),
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-card">
      <input
        defaultValue={sp.get("q") ?? ""}
        placeholder="Search title, locality, city…"
        onKeyDown={(e) => {
          if (e.key === "Enter") setParam("q", (e.target as HTMLInputElement).value);
        }}
        className="h-8 min-w-[200px] flex-1 rounded-md border border-input bg-surface px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <select
        value={sp.get("type") ?? ""}
        onChange={(e) => setParam("type", e.target.value)}
        className="h-8 rounded-md border border-input bg-surface px-2 text-xs"
        aria-label="Type"
      >
        <option value="">Type: all</option>
        <option value="APARTMENT">Apartment</option>
        <option value="VILLA">Villa</option>
        <option value="INDEPENDENT_HOUSE">Independent House</option>
        <option value="PLOT">Plot</option>
        <option value="COMMERCIAL">Commercial</option>
        <option value="OFFICE">Office</option>
        <option value="SHOP">Shop</option>
        <option value="WAREHOUSE">Warehouse</option>
      </select>
      <select
        value={sp.get("purpose") ?? ""}
        onChange={(e) => setParam("purpose", e.target.value)}
        className="h-8 rounded-md border border-input bg-surface px-2 text-xs"
        aria-label="Purpose"
      >
        <option value="">Purpose: all</option>
        <option value="SALE">Sale</option>
        <option value="RENT">Rent</option>
        <option value="LEASE">Lease</option>
      </select>
      <select
        value={sp.get("status") ?? ""}
        onChange={(e) => setParam("status", e.target.value)}
        className="h-8 rounded-md border border-input bg-surface px-2 text-xs"
        aria-label="Status"
      >
        <option value="">Status: all</option>
        <option value="AVAILABLE">Available</option>
        <option value="RESERVED">Reserved</option>
        <option value="SOLD">Sold</option>
        <option value="RENTED">Rented</option>
        <option value="WITHDRAWN">Withdrawn</option>
      </select>
      <select
        value={sp.get("city") ?? ""}
        onChange={(e) => setParam("city", e.target.value)}
        className="h-8 rounded-md border border-input bg-surface px-2 text-xs"
        aria-label="City"
      >
        <option value="">City: all</option>
        {cities.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {has && (
        <Button size="sm" variant="ghost" onClick={() => router.push(pathname)} className="text-xs text-muted-foreground">
          <X className="size-3" /> Clear
        </Button>
      )}
    </div>
  );
}