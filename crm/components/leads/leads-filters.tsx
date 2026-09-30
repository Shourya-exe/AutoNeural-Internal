"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { CHANNEL_META } from "@/components/domain/badges";

interface Opt {
  stages: { id: string; key: string; name: string }[];
  services: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  members: { userId: string; user: { name: string } }[];
}

export function LeadsFilters({ options }: { options: Opt }) {
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
    ["q", "source", "stageKey", "ownerId", "serviceId", "priority", "tag", "overdueOnly", "status", "archived", "from", "to"].includes(k),
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-card">
      <input
        defaultValue={sp.get("q") ?? ""}
        placeholder="Search name, company, phone, email…"
        onKeyDown={(e) => {
          if (e.key === "Enter") setParam("q", (e.target as HTMLInputElement).value);
        }}
        className="h-8 min-w-[220px] flex-1 rounded-md border border-input bg-surface px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <Filter label="Source" value={sp.get("source") ?? ""} onChange={(v) => setParam("source", v)}>
        {Object.entries(CHANNEL_META).map(([k, m]) => (
          <option key={k} value={k}>
            {m.label}
          </option>
        ))}
      </Filter>
      <Filter label="Stage" value={sp.get("stageKey") ?? ""} onChange={(v) => setParam("stageKey", v)}>
        {options.stages.map((s) => (
          <option key={s.id} value={s.key}>
            {s.name}
          </option>
        ))}
      </Filter>
      <Filter label="Owner" value={sp.get("ownerId") ?? ""} onChange={(v) => setParam("ownerId", v)}>
        <option value="unassigned">Unassigned</option>
        {options.members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.user.name}
          </option>
        ))}
      </Filter>
      <Filter label="Service" value={sp.get("serviceId") ?? ""} onChange={(v) => setParam("serviceId", v)}>
        {options.services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Filter>
      <Filter label="Priority" value={sp.get("priority") ?? ""} onChange={(v) => setParam("priority", v)}>
        {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
          <option key={p} value={p}>
            {p[0] + p.slice(1).toLowerCase()}
          </option>
        ))}
      </Filter>
      <Filter label="Tag" value={sp.get("tag") ?? ""} onChange={(v) => setParam("tag", v)}>
        {options.tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Filter>
      <label className="flex items-center gap-1.5 text-xs text-espresso-500">
        <input
          type="checkbox"
          checked={sp.get("overdueOnly") === "1"}
          onChange={(e) => setParam("overdueOnly", e.target.checked ? "1" : "")}
          className="accent-gold"
        />
        Overdue follow-up
      </label>
      <label className="flex items-center gap-1.5 text-xs text-espresso-500">
        <input
          type="checkbox"
          checked={sp.get("archived") === "1"}
          onChange={(e) => setParam("archived", e.target.checked ? "1" : "")}
          className="accent-gold"
        />
        Archived
      </label>
      {has && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => router.push(pathname)}
          className="text-xs text-muted-foreground"
        >
          <X className="size-3" /> Clear
        </Button>
      )}
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-auto text-xs"
      aria-label={label}
    >
      <option value="">{label}: all</option>
      {children}
    </Select>
  );
}
