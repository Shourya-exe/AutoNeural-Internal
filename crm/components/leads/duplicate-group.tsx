"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { channelMeta } from "@/components/domain/badges";
import { mergeLeadsAction } from "@/app/(app)/leads/actions";
import { Merge } from "lucide-react";

export interface DupLead {
  id: string;
  contactName: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  sourceChannel: string;
  stageName: string;
  ownerName: string | null;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
  taskCount: number;
}

export function DuplicateGroupCard({
  matchedOn,
  value,
  leads,
  canMerge,
}: {
  matchedOn: "phone" | "email";
  value: string;
  leads: DupLead[];
  canMerge: boolean;
}) {
  const router = useRouter();
  const [primaryId, setPrimaryId] = useState(leads[0]?.id ?? "");
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const others = leads.filter((l) => l.id !== primaryId);

  return (
    <div className="rounded-lg border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Badge variant="gold">Matched on {matchedOn}</Badge>
          <code className="font-mono text-[11px] text-espresso-700">{value}</code>
          <span className="text-[11px] text-muted-foreground">{leads.length} leads</span>
        </div>
        {canMerge && (
          <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
            <Merge className="size-3.5" /> Merge into selected
          </Button>
        )}
      </div>

      <div className="divide-y divide-border">
        {leads.map((l) => (
          <label
            key={l.id}
            className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-champagne-50"
          >
            <input
              type="radio"
              name={`primary-${value}`}
              checked={primaryId === l.id}
              onChange={() => setPrimaryId(l.id)}
              className="mt-1 accent-gold"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link
                  href={`/leads/${l.id}`}
                  className="text-sm font-medium text-espresso hover:text-gold-700"
                  onClick={(e) => e.stopPropagation()}
                >
                  {l.contactName}
                </Link>
                <Badge variant="outline">{channelMeta(l.sourceChannel).label}</Badge>
                <Badge variant="default">{l.stageName}</Badge>
                {primaryId === l.id && <Badge variant="success">Keep this one</Badge>}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {l.company ?? "No company"} · {l.phone ?? l.email ?? "no contact info"} ·{" "}
                {l.ownerName ?? "Unassigned"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                created {l.createdAt} · last activity {l.lastActivityAt} · {l.messageCount}{" "}
                message(s) · {l.taskCount} task(s)
              </p>
            </div>
          </label>
        ))}
      </div>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Merge duplicate leads"
        description="Conversations, messages, notes, tasks, activities, touchpoints and attachments move to the lead you keep. The others are archived and marked as merged — nothing is deleted."
      >
        <div className="space-y-3">
          <div className="rounded-md bg-champagne-50 p-3 text-xs">
            <p className="font-medium text-espresso-700">
              Keep: {leads.find((l) => l.id === primaryId)?.contactName}
            </p>
            <p className="mt-1 text-muted-foreground">
              Merge in: {others.map((o) => o.contactName).join(", ") || "nothing selected"}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Only merge when you are confident these are the same person. Matching on{" "}
            {matchedOn} is strong evidence, not proof — a shared office phone or a family email
            can produce a false match.
          </p>
          {err && <p className="text-xs text-danger-600">{err}</p>}
          <Button
            className="w-full"
            disabled={pending || others.length === 0}
            onClick={() =>
              start(async () => {
                setErr(null);
                for (const o of others) {
                  const res = await mergeLeadsAction(primaryId, o.id);
                  if (!res.ok) {
                    setErr(res.error);
                    return;
                  }
                }
                setConfirm(false);
                router.refresh();
              })
            }
          >
            {pending ? "Merging…" : `Merge ${others.length} lead(s)`}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
