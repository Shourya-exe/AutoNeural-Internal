"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renameStageAction } from "@/app/(app)/settings/actions";

export function StageRow({
  id,
  name,
  stageKey,
  order,
  isWon,
  isLost,
  leadCount,
}: {
  id: string;
  name: string;
  stageKey: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
  leadCount: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [pending, start] = useTransition();
  const dirty = value.trim() !== name;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
      <span className="w-6 text-xs tabular-nums text-muted-foreground">{order}</span>
      <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-8 max-w-[220px]" />
      <code className="rounded bg-champagne-50 px-1.5 py-0.5 font-mono text-[10px] text-espresso-500">
        {stageKey}
      </code>
      {isWon && <Badge variant="success">Won stage</Badge>}
      {isLost && <Badge variant="danger">Lost stage · reason required</Badge>}
      <Badge variant="outline">{leadCount} leads</Badge>
      <Button
        size="sm"
        variant={dirty ? "default" : "ghost"}
        disabled={!dirty || pending}
        className="ml-auto"
        onClick={() =>
          start(async () => {
            await renameStageAction(id, value);
            router.refresh();
          })
        }
      >
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
