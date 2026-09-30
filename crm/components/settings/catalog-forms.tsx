"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addServiceAction, addTagAction, deleteTagAction } from "@/app/(app)/settings/actions";
import { X } from "lucide-react";

export function CatalogForms({
  kind,
  tags,
}: {
  kind: "service" | "tag";
  tags?: { id: string; name: string; color: string; count: number }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#8C1C2B");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {kind === "tag" && tags && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
              style={{ background: `${t.color}22`, color: t.color }}
            >
              {t.name}
              <span className="opacity-60">{t.count}</span>
              <button
                onClick={() =>
                  start(async () => {
                    await deleteTagAction(t.id);
                    router.refresh();
                  })
                }
                aria-label={`Delete tag ${t.name}`}
                className="ml-0.5 opacity-60 hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {tags.length === 0 && <p className="text-xs text-muted-foreground">No tags yet.</p>}
        </div>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setErr(null);
            const res =
              kind === "service" ? await addServiceAction(name) : await addTagAction(name, color);
            if (res.ok) {
              setName("");
              router.refresh();
            } else setErr(res.error);
          });
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === "service" ? "New service name" : "New tag name"}
          className="h-8 max-w-[240px]"
        />
        {kind === "tag" && (
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded-md border border-input bg-surface"
            aria-label="Tag colour"
          />
        )}
        <Button size="sm" type="submit" disabled={pending || !name.trim()}>
          Add
        </Button>
        {err && <span className="text-[11px] text-danger-600">{err}</span>}
      </form>
    </div>
  );
}
