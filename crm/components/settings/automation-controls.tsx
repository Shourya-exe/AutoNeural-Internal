"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  toggleAutomationAction,
  updateOrgSlaAction,
} from "@/app/(app)/settings/actions";

export function AutomationRow({
  id,
  name,
  triggerLabel,
  enabled,
  sendsCustomerMessage,
  config,
  runCount,
}: {
  id: string;
  name: string;
  triggerLabel: string;
  enabled: boolean;
  sendsCustomerMessage: boolean;
  config: Record<string, unknown>;
  runCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(enabled);

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-espresso-700">{name}</p>
        <p className="text-[11px] text-muted-foreground">{triggerLabel}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Badge variant="outline">{runCount} runs</Badge>
          {sendsCustomerMessage ? (
            <Badge variant="danger">Sends customer message</Badge>
          ) : (
            <Badge variant="muted">Internal only</Badge>
          )}
          {Object.entries(config).map(([k, v]) => (
            <Badge key={k} variant="outline">
              {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
            </Badge>
          ))}
        </div>
      </div>
      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[11px]">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          className="accent-gold"
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            start(async () => {
              const res = await toggleAutomationAction(id, next);
              if (!res.ok) setOn(!next);
              router.refresh();
            });
          }}
        />
        <span className={on ? "text-emerald-600" : "text-muted-foreground"}>
          {on ? "Enabled" : "Disabled"}
        </span>
      </label>
    </div>
  );
}

export function SlaForm({
  noResponseSlaMins,
  followUpSlaHours,
}: {
  noResponseSlaMins: number;
  followUpSlaHours: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget as HTMLFormElement);
        start(async () => {
          await updateOrgSlaAction(Number(fd.get("mins")), Number(fd.get("hours")));
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
          router.refresh();
        });
      }}
    >
      <div className="space-y-1">
        <Label>First-response SLA (minutes)</Label>
        <Input name="mins" type="number" min={5} defaultValue={noResponseSlaMins} className="w-40" />
      </div>
      <div className="space-y-1">
        <Label>Follow-up SLA (hours)</Label>
        <Input name="hours" type="number" min={1} defaultValue={followUpSlaHours} className="w-40" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : saved ? "Saved" : "Save"}
      </Button>
    </form>
  );
}
