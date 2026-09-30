"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { ChannelBadge, PriorityBadge, StageBadge } from "@/components/domain/badges";
import { ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { bulkAssignAction, bulkStageAction } from "@/app/(app)/leads/actions";

export interface LeadRow {
  id: string;
  title: string;
  contactName: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  source: any;
  campaign: string | null;
  service: string | null;
  stageName: string;
  isWon: boolean;
  isLost: boolean;
  priority: any;
  ownerName: string | null;
  estimatedValue: string;
  createdAt: string;
  lastActivityAt: string;
  nextFollowUpAt: string | null;
  overdue: boolean;
  tags: { name: string; color: string }[];
}

const COLUMNS: { key: string; label: string; sortable?: boolean }[] = [
  { key: "title", label: "Lead", sortable: true },
  { key: "source", label: "Source" },
  { key: "service", label: "Service" },
  { key: "stage", label: "Stage" },
  { key: "priority", label: "Priority" },
  { key: "owner", label: "Owner" },
  { key: "estimatedValue", label: "Value", sortable: true },
  { key: "createdAt", label: "Created", sortable: true },
  { key: "nextFollowUpAt", label: "Next follow-up", sortable: true },
];

export function LeadsTable({
  rows,
  page,
  pageCount,
  total,
  canBulk,
  members,
  stages,
}: {
  rows: LeadRow[];
  page: number;
  pageCount: number;
  total: number;
  canBulk: boolean;
  members: { userId: string; name: string }[];
  stages: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState<null | "assign" | "stage">(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const sort = sp.get("sort") ?? "lastActivityAt";
  const dir = sp.get("dir") ?? "desc";

  function setSort(key: string) {
    const next = new URLSearchParams(sp);
    const col = key === "title" ? "title" : key;
    if (sort === col) next.set("dir", dir === "asc" ? "desc" : "asc");
    else {
      next.set("sort", col);
      next.set("dir", "desc");
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  function goPage(p: number) {
    const next = new URLSearchParams(sp);
    next.set("page", String(p));
    router.push(`${pathname}?${next.toString()}`);
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-3">
      {canBulk && selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-gold/30 bg-gold/10 px-3 py-2 text-xs">
          <span className="font-medium text-gold-700">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => setBulkOpen("assign")}>
            Bulk assign
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkOpen("stage")}>
            Bulk stage update
          </Button>
          <button
            className="ml-auto text-muted-foreground hover:underline"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      <Table>
        <THead>
          <TR>
            {canBulk && (
              <TH className="w-8">
                <input
                  type="checkbox"
                  className="accent-gold"
                  checked={allSelected}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                  }
                />
              </TH>
            )}
            {COLUMNS.map((c) => (
              <TH key={c.key}>
                {c.sortable ? (
                  <button
                    onClick={() => setSort(c.key)}
                    className="inline-flex items-center gap-1 hover:text-espresso-700"
                  >
                    {c.label}
                    <ArrowUpDown className="size-3 opacity-50" />
                  </button>
                ) : (
                  c.label
                )}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              {canBulk && (
                <TD>
                  <input
                    type="checkbox"
                    className="accent-gold"
                    checked={selected.has(r.id)}
                    onChange={(e) => {
                      const n = new Set(selected);
                      e.target.checked ? n.add(r.id) : n.delete(r.id);
                      setSelected(n);
                    }}
                  />
                </TD>
              )}
              <TD>
                <Link href={`/leads/${r.id}`} className="block">
                  <span className="font-medium text-espresso hover:text-gold-700">
                    {r.contactName}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {r.company ?? "—"} · {r.phone ?? r.email ?? "no contact info"}
                  </span>
                  {r.tags.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <span
                          key={t.name}
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{ background: `${t.color}33`, boxShadow: `inset 0 0 0 1px ${t.color}55`, color: `color-mix(in srgb, ${t.color} 40%, white)` }}
                        >
                          {t.name}
                        </span>
                      ))}
                    </span>
                  )}
                </Link>
              </TD>
              <TD>
                <ChannelBadge channel={r.source} />
                {r.campaign && (
                  <span className="block text-[10px] text-muted-foreground">{r.campaign}</span>
                )}
              </TD>
              <TD className="text-xs">{r.service ?? "—"}</TD>
              <TD>
                <StageBadge name={r.stageName} isWon={r.isWon} isLost={r.isLost} />
              </TD>
              <TD>
                <PriorityBadge priority={r.priority} />
              </TD>
              <TD className="text-xs">{r.ownerName ?? <span className="text-gold-700">Unassigned</span>}</TD>
              <TD className="text-xs tabular-nums">{r.estimatedValue}</TD>
              <TD className="whitespace-nowrap text-[11px] text-muted-foreground">{r.createdAt}</TD>
              <TD className="whitespace-nowrap text-[11px]">
                {r.nextFollowUpAt ? (
                  <Badge variant={r.overdue ? "danger" : "muted"}>
                    {r.overdue ? "Overdue · " : ""}
                    {r.nextFollowUpAt}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TD>
            </TR>
          ))}
          {rows.length === 0 && (
            <TR>
              <TD colSpan={COLUMNS.length + (canBulk ? 1 : 0)} className="py-10 text-center text-xs text-muted-foreground">
                No leads match these filters.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total} lead{total === 1 ? "" : "s"} · page {page} / {pageCount}
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => goPage(page - 1)}>
            <ChevronLeft className="size-3" /> Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pageCount}
            onClick={() => goPage(page + 1)}
          >
            Next <ChevronRight className="size-3" />
          </Button>
        </div>
      </div>

      {/* Bulk dialogs */}
      <Dialog
        open={bulkOpen === "assign"}
        onClose={() => setBulkOpen(null)}
        title="Bulk assign leads"
        description={`${selected.size} lead(s) will be reassigned.`}
      >
        <BulkAssign
          members={members}
          pending={pending}
          err={err}
          onSubmit={(ownerId) =>
            start(async () => {
              setErr(null);
              const res = await bulkAssignAction([...selected], ownerId);
              if (res.ok) {
                setSelected(new Set());
                setBulkOpen(null);
                router.refresh();
              } else setErr(res.error);
            })
          }
        />
      </Dialog>

      <Dialog
        open={bulkOpen === "stage"}
        onClose={() => setBulkOpen(null)}
        title="Bulk stage update"
        description={`${selected.size} lead(s) will be moved.`}
      >
        <BulkStage
          stages={stages}
          pending={pending}
          err={err}
          onSubmit={(stageId, reason) =>
            start(async () => {
              setErr(null);
              const res = await bulkStageAction([...selected], stageId, reason);
              if (res.ok) {
                setSelected(new Set());
                setBulkOpen(null);
                router.refresh();
              } else setErr(res.error);
            })
          }
        />
      </Dialog>
    </div>
  );
}

function BulkAssign({
  members,
  onSubmit,
  pending,
  err,
}: {
  members: { userId: string; name: string }[];
  onSubmit: (ownerId: string | null) => void;
  pending: boolean;
  err: string | null;
}) {
  const [owner, setOwner] = useState("");
  return (
    <div className="space-y-3">
      <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
        <option value="">Unassign</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </Select>
      {err && <p className="text-xs text-danger-600">{err}</p>}
      <Button disabled={pending} onClick={() => onSubmit(owner || null)} className="w-full">
        {pending ? "Applying…" : "Apply"}
      </Button>
    </div>
  );
}

function BulkStage({
  stages,
  onSubmit,
  pending,
  err,
}: {
  stages: { id: string; name: string }[];
  onSubmit: (stageId: string, reason?: string) => void;
  pending: boolean;
  err: string | null;
}) {
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const isLost = stages.find((s) => s.id === stageId)?.name.toLowerCase() === "lost";
  return (
    <div className="space-y-3">
      <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      {isLost && (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for marking Lost (required)"
          className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm"
        />
      )}
      {err && <p className="text-xs text-danger-600">{err}</p>}
      <Button
        disabled={pending || (isLost && !reason.trim())}
        onClick={() => onSubmit(stageId, reason)}
        className="w-full"
      >
        {pending ? "Applying…" : "Apply"}
      </Button>
    </div>
  );
}
